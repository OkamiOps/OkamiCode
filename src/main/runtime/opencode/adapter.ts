import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type {
  CanonicalEvent,
  CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { TaskId } from "../../../shared/ids";
import type {
  ApprovalResponse,
  NativeSession,
  NativeTurnRequest,
  ResumeSessionRequest,
  RunHandle,
  RuntimeAdapter,
  RuntimeHealth,
  StartSessionRequest,
  UsageCapabilities,
} from "../adapter";
import {
  connectAcpProcess,
  type AcpClientHandlers,
  type AcpConnection,
  type AcpConnectionFactory,
} from "../acp/connection";
import { executableEnvironment } from "../commands";

interface ExecuteResult {
  stdout: string;
  stderr?: string;
}

interface OpenCodeSession {
  laneId: NativeSession["laneId"];
  nativeSessionId: string;
  cwd: string;
  version: string;
  connection: AcpConnection;
}

interface PendingPermission {
  request: RequestPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
}

interface ActiveRun {
  request: NativeTurnRequest;
  taskId: TaskId;
  queue: AsyncQueue<CanonicalEvent>;
  sequence: number;
  text: string;
  pendingPermissions: Map<string, PendingPermission>;
}

export interface OpenCodeAdapterDependencies {
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  command?: string;
  env?: NodeJS.ProcessEnv;
  execute?: (
    command: string,
    args: string[],
    options?: { env: NodeJS.ProcessEnv },
  ) => Promise<ExecuteResult>;
  connect?: AcpConnectionFactory;
  createEventId?: (sequence: number) => string;
  clock?: () => Date;
}

export class OpenCodeAdapter implements RuntimeAdapter {
  readonly kind = "opencode" as const;
  private readonly sessions = new Map<string, OpenCodeSession>();
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(private readonly dependencies: OpenCodeAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    const command = this.dependencies.command ?? "opencode";
    const execute = this.dependencies.execute ?? executeFile;
    const env = executableEnvironment(command, {
      ...process.env,
      ...this.dependencies.env,
    });
    try {
      const versionResult = await execute(command, ["--version"], { env });
      const version =
        versionResult.stdout.match(/\b\d+\.\d+\.\d+\b/u)?.[0] ?? null;
      const helpResult = await execute(command, ["acp", "--help"], { env });
      const help = `${helpResult.stdout}\n${helpResult.stderr ?? ""}`;
      const protocolSupported = /\bacp\b/iu.test(help);
      return {
        available: true,
        protocolSupported,
        version,
        ...(protocolSupported
          ? {}
          : { detail: "OpenCode did not advertise the ACP command" }),
      };
    } catch (error) {
      return {
        available: false,
        protocolSupported: false,
        version: null,
        detail: errorMessage(error),
      };
    }
  }

  async start(request: StartSessionRequest): Promise<NativeSession> {
    const health = await this.requireProtocol();
    const session = await this.connect(request, health.version);
    const created = await session.connection.newSession(request.cwd);
    session.nativeSessionId = created.sessionId;
    this.sessions.set(created.sessionId, session);
    if (request.model && request.model !== "default") {
      await session.connection.setModel(created.sessionId, request.model);
    }
    return {
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId: created.sessionId,
      runtimeVersion: session.version,
    };
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    const health = await this.requireProtocol();
    const session = await this.connect(request, health.version);
    await session.connection.resumeSession(
      request.nativeSessionId,
      request.cwd,
    );
    session.nativeSessionId = request.nativeSessionId;
    this.sessions.set(request.nativeSessionId, session);
    if (request.model && request.model !== "default") {
      await session.connection.setModel(request.nativeSessionId, request.model);
    }
    return {
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId: request.nativeSessionId,
      runtimeVersion: session.version,
    };
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    if (!request.nativeSessionId) {
      throw new Error("OpenCode ACP requires an authoritative session");
    }
    const session = this.sessions.get(request.nativeSessionId);
    if (!session || session.laneId !== request.laneId) {
      throw new Error("OpenCode session does not belong to the requested lane");
    }
    if (this.activeRuns.has(request.runId)) {
      throw new Error(`OpenCode run ${request.runId} is already active`);
    }
    const run: ActiveRun = {
      request,
      taskId: await this.dependencies.taskIdForRun(request.runId),
      queue: new AsyncQueue<CanonicalEvent>(),
      sequence: 0,
      text: "",
      pendingPermissions: new Map(),
    };
    this.activeRuns.set(request.runId, run);
    void this.executePrompt(session, run);
    return { runId: request.runId, events: run.queue };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    const run = this.activeRuns.get(response.runId);
    const pending = run?.pendingPermissions.get(response.approvalId);
    if (!run || !pending) {
      throw new Error(`Unknown OpenCode approval ${response.approvalId}`);
    }
    run.pendingPermissions.delete(response.approvalId);
    const selected =
      response.decision === "allow_once"
        ? pending.request.options.find((option) =>
            option.kind.startsWith("allow"),
          )
        : pending.request.options.find((option) =>
            option.kind.startsWith("reject"),
          );
    pending.resolve(
      selected
        ? {
            outcome: {
              outcome: "selected",
              optionId: selected.optionId,
            },
          }
        : { outcome: { outcome: "cancelled" } },
    );
    this.emit(run, "approval_resolved", {
      approvalId: response.approvalId,
      decision: response.decision,
    });
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run?.request.nativeSessionId) return;
    for (const pending of run.pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    run.pendingPermissions.clear();
    const session = this.sessions.get(run.request.nativeSessionId);
    await session?.connection.cancel(run.request.nativeSessionId);
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: false,
      contextSnapshot: true,
      activitySnapshot: true,
    };
  }

  private async connect(
    request: StartSessionRequest,
    version: string | null,
  ): Promise<OpenCodeSession> {
    const sessionBox: { current?: OpenCodeSession } = {};
    const handlers: AcpClientHandlers = {
      sessionUpdate: async (notification) => {
        if (sessionBox.current) {
          this.handleUpdate(sessionBox.current, notification);
        }
      },
      requestPermission: async (permission) => {
        if (!sessionBox.current) {
          return { outcome: { outcome: "cancelled" } };
        }
        return this.handlePermission(sessionBox.current, permission);
      },
    };
    const connection = await (this.dependencies.connect ?? connectAcpProcess)({
      command: this.dependencies.command ?? "opencode",
      args: ["acp", "--cwd", request.cwd],
      cwd: request.cwd,
      env: executableEnvironment(this.dependencies.command ?? "opencode", {
        ...process.env,
        ...this.dependencies.env,
        ...request.env,
      }),
      handlers,
    });
    await connection.initialize();
    const session: OpenCodeSession = {
      laneId: request.laneId,
      nativeSessionId: "",
      cwd: request.cwd,
      version: version ?? "unknown",
      connection,
    };
    sessionBox.current = session;
    return session;
  }

  private handleUpdate(
    session: OpenCodeSession,
    notification: SessionNotification,
  ): void {
    if (notification.sessionId !== session.nativeSessionId) return;
    const run = [...this.activeRuns.values()].find(
      (candidate) =>
        candidate.request.nativeSessionId === session.nativeSessionId,
    );
    if (!run) return;
    const update = notification.update;
    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text"
    ) {
      run.text += update.content.text;
      this.emit(run, "message_delta", { text: update.content.text });
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      this.emit(run, "tool_call_started", {
        toolCallId: update.toolCallId,
        title: update.title,
        status: update.status,
        kind: update.kind,
      });
      return;
    }
    if (update.sessionUpdate === "tool_call_update") {
      this.emit(
        run,
        update.status === "completed" || update.status === "failed"
          ? "tool_call_completed"
          : "tool_call_updated",
        {
          toolCallId: update.toolCallId,
          title: update.title,
          status: update.status,
          rawOutput: update.rawOutput,
        },
      );
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      this.emit(run, "usage_reported", {
        runtime: "opencode",
        usage: {
          available: false,
          source: "opencode_acp_context_only",
        },
        context: {
          used_tokens: update.used,
          size_tokens: update.size,
        },
      });
    }
  }

  private handlePermission(
    session: OpenCodeSession,
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const run = [...this.activeRuns.values()].find(
      (candidate) =>
        candidate.request.nativeSessionId === session.nativeSessionId,
    );
    if (!run) {
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }
    return new Promise((resolve) => {
      run.pendingPermissions.set(request.toolCall.toolCallId, {
        request,
        resolve,
      });
      this.emit(run, "approval_requested", {
        approvalId: request.toolCall.toolCallId,
        toolCall: request.toolCall,
        options: request.options,
      });
    });
  }

  private async executePrompt(
    session: OpenCodeSession,
    run: ActiveRun,
  ): Promise<void> {
    try {
      const result = await session.connection.prompt(
        session.nativeSessionId,
        run.request.input,
      );
      this.emit(run, "message_completed", { text: run.text });
      this.emit(
        run,
        result.stopReason === "cancelled" ? "run_cancelled" : "run_completed",
        { stopReason: result.stopReason },
      );
      run.queue.close();
    } catch (error) {
      this.emit(run, "run_failed", { message: errorMessage(error) });
      run.queue.close();
    } finally {
      this.activeRuns.delete(run.request.runId);
    }
  }

  private emit(
    run: ActiveRun,
    kind: CanonicalEventKind,
    payload: Record<string, unknown>,
  ): void {
    const sequence = run.sequence++;
    run.queue.push({
      schemaVersion: 1,
      id: this.dependencies.createEventId?.(sequence) ?? randomUUID(),
      taskId: run.taskId,
      laneId: run.request.laneId,
      runId: run.request.runId,
      sequence,
      occurredAt: (this.dependencies.clock?.() ?? new Date()).toISOString(),
      kind,
      nativeEventId: null,
      payload,
    });
  }

  private async requireProtocol(): Promise<RuntimeHealth> {
    const health = await this.detect();
    if (!health.available || !health.protocolSupported) {
      throw new Error(health.detail ?? "OpenCode ACP is unavailable");
    }
    return health;
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.ended) return { done: true, value: undefined };
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const execFileAsync = promisify(execFile);

async function executeFile(
  command: string,
  args: string[],
  options?: { env: NodeJS.ProcessEnv },
): Promise<ExecuteResult> {
  const result = await execFileAsync(command, args, {
    ...options,
    windowsHide: true,
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}
