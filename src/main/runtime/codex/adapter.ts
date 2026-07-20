import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ApprovalRepository } from "../../policy/approval";
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
import { JsonlProcess } from "../transport";
import {
  CodexClient,
  type CodexApprovalPolicy,
  type CodexSandboxPolicy,
  type CodexServerMessage,
  type JsonRpcId,
} from "./client";
import { CodexProjector } from "./projector";

const execFileAsync = promisify(execFile);
const SUPPORTED_CODEX_VERSION = "0.144.5";

export interface ApprovalBroker {
  resolvedDecision(
    approvalId: string,
  ): Promise<ApprovalResponse["decision"] | undefined>;
}

export function codexPermissions(mode: string | undefined): {
  approvalPolicy: CodexApprovalPolicy;
  sandboxPolicy: CodexSandboxPolicy;
} {
  switch (mode) {
    case "bypassPermissions":
      return { approvalPolicy: "never", sandboxPolicy: "danger-full-access" };
    case "auto":
      return { approvalPolicy: "never", sandboxPolicy: "workspace-write" };
    case "acceptEdits":
      return { approvalPolicy: "on-failure", sandboxPolicy: "workspace-write" };
    case "plan":
      return { approvalPolicy: "untrusted", sandboxPolicy: "read-only" };
    default:
      return { approvalPolicy: "on-request", sandboxPolicy: "workspace-write" };
  }
}

export class RepositoryApprovalBroker implements ApprovalBroker {
  constructor(
    private readonly approvals: Pick<ApprovalRepository, "findById">,
  ) {}

  async resolvedDecision(
    approvalId: string,
  ): Promise<ApprovalResponse["decision"] | undefined> {
    const approval = this.approvals.findById(approvalId);
    if (!approval || approval.status === "pending") return undefined;
    return approval.status === "allowed_once" ? "allow_once" : "deny";
  }
}

export interface CodexAdapterDependencies {
  approvalBroker: ApprovalBroker;
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  command?: string;
  env?: NodeJS.ProcessEnv;
}

interface CodexSessionState {
  laneId: NativeSession["laneId"];
  nativeSessionId: string;
  runtimeVersion: string;
  client: CodexClient;
  resumed: boolean;
}

interface ActiveCodexRun {
  runId: NativeTurnRequest["runId"];
  threadId: string;
  turnId: string;
  client: CodexClient;
}

interface PendingCodexApproval {
  runId: NativeTurnRequest["runId"];
  requestId: JsonRpcId;
  client: CodexClient;
}

export class CodexAdapter implements RuntimeAdapter {
  readonly kind = "codex" as const;
  private readonly sessions = new Map<string, CodexSessionState>();
  private readonly activeRuns = new Map<
    NativeTurnRequest["runId"],
    ActiveCodexRun
  >();
  private readonly pendingApprovals = new Map<string, PendingCodexApproval>();

  constructor(private readonly dependencies: CodexAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    try {
      const { stdout } = await execFileAsync(
        this.dependencies.command ?? "codex",
        ["--version"],
        { env: subscriptionEnvironment(this.dependencies.env) },
      );
      const version = /codex-cli\s+([^\s]+)/.exec(stdout)?.[1] ?? null;
      const protocolSupported = version === SUPPORTED_CODEX_VERSION;
      return {
        available: true,
        protocolSupported,
        version,
        detail: protocolSupported
          ? undefined
          : `Unsupported Codex app-server protocol version: ${version ?? "unknown"}`,
      };
    } catch (error) {
      return {
        available: false,
        protocolSupported: false,
        version: null,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  start(request: StartSessionRequest): Promise<NativeSession> {
    return this.openSession(request, false);
  }

  resume(request: ResumeSessionRequest): Promise<NativeSession> {
    return this.openSession(request, true);
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    const session = this.sessions.get(request.nativeSessionId);
    if (!session)
      throw new Error(`Unknown Codex thread ${request.nativeSessionId}`);
    if (session.laneId !== request.laneId) {
      throw new Error("Codex thread does not belong to the requested lane");
    }

    const response = await session.client.startTurn(
      request.nativeSessionId,
      request.input,
    );
    const turnId = requiredNestedId(response, "turn");
    const run = {
      runId: request.runId,
      threadId: request.nativeSessionId,
      turnId,
      client: session.client,
    };
    this.activeRuns.set(request.runId, run);
    const taskId = await this.dependencies.taskIdForRun(request.runId);
    const projector = new CodexProjector({
      taskId,
      laneId: request.laneId,
      runId: request.runId,
      createEventId: () => randomUUID(),
    });

    return {
      runId: request.runId,
      events: this.projectRunEvents(run, session, projector),
    };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    const pending = this.pendingApprovals.get(response.approvalId);
    if (!pending || pending.runId !== response.runId) {
      throw new Error(`No pending Codex approval ${response.approvalId}`);
    }

    const resolved = await this.dependencies.approvalBroker.resolvedDecision(
      response.approvalId,
    );
    if (!resolved)
      throw new Error(`Approval ${response.approvalId} is still pending`);
    if (resolved !== response.decision) {
      throw new Error(`Approval ${response.approvalId} decision mismatch`);
    }

    await pending.client.respond(pending.requestId, {
      decision: resolved === "allow_once" ? "accept" : "decline",
    });
    this.pendingApprovals.delete(response.approvalId);
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    await run.client.interruptTurn(run.threadId, run.turnId);
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: true,
      contextSnapshot: true,
      activitySnapshot: true,
    };
  }

  private async openSession(
    request: StartSessionRequest | ResumeSessionRequest,
    resume: boolean,
  ): Promise<NativeSession> {
    const health = await this.detect();
    if (!health.available || !health.protocolSupported || !health.version) {
      throw new Error(health.detail ?? "Codex CLI is unavailable");
    }

    const process = await JsonlProcess.spawn(
      this.dependencies.command ?? "codex",
      ["app-server", "--stdio"],
      {
        cwd: request.cwd,
        env: subscriptionEnvironment(this.dependencies.env),
      },
    );
    const client = new CodexClient(process);
    try {
      await client.initialize();
      // The lane's mode has to reach Codex too: picking "automático" must
      // stop it asking, exactly like it does for the Claude harness.
      const options = {
        cwd: request.cwd,
        model: request.model,
        ...codexPermissions(request.permissionMode),
        approvalsReviewer: "user" as const,
      };
      const response = resume
        ? await client.resumeThread(
            (request as ResumeSessionRequest).nativeSessionId,
            options,
          )
        : await client.startThread(request.cwd, options);
      const nativeSessionId = requiredNestedId(response, "thread");
      const state = {
        laneId: request.laneId,
        nativeSessionId,
        runtimeVersion: health.version,
        client,
        resumed: resume,
      };
      this.sessions.set(nativeSessionId, state);
      return {
        laneId: state.laneId,
        nativeSessionId,
        runtimeVersion: state.runtimeVersion,
      };
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async *projectRunEvents(
    run: ActiveCodexRun,
    session: CodexSessionState,
    projector: CodexProjector,
  ): AsyncIterable<ReturnType<CodexProjector["project"]>[number]> {
    try {
      for (;;) {
        const incoming = await run.client.nextServerMessage();
        if (!incoming) break;
        const message = normalizeResumeNotification(incoming, session);
        this.trackApproval(message, run);
        for (const event of projector.project(message)) yield event;
        if (isCompletedTurn(message, run.turnId)) break;
      }
    } finally {
      this.activeRuns.delete(run.runId);
      for (const [approvalId, pending] of this.pendingApprovals) {
        if (pending.runId === run.runId)
          this.pendingApprovals.delete(approvalId);
      }
    }
  }

  private trackApproval(
    message: CodexServerMessage,
    run: ActiveCodexRun,
  ): void {
    const params = record(message.params) ?? {};
    if (message.method === "serverRequest/resolved") {
      const requestId = scalar(params.requestId);
      if (!requestId) return;
      for (const [approvalId, pending] of this.pendingApprovals) {
        if (String(pending.requestId) === requestId) {
          this.pendingApprovals.delete(approvalId);
        }
      }
      return;
    }
    if (
      message.id !== undefined &&
      message.method.endsWith("/requestApproval")
    ) {
      const approvalId = scalar(params.approvalId) ?? String(message.id);
      this.pendingApprovals.set(approvalId, {
        runId: run.runId,
        requestId: message.id,
        client: run.client,
      });
    }
  }
}

export function subscriptionEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.OPENAI_API_KEY;
  delete environment.ANTHROPIC_API_KEY;
  return environment;
}

function requiredNestedId(value: unknown, key: string): string {
  const id = scalar(record(record(value)?.[key])?.id);
  if (!id) throw new Error(`Codex response is missing ${key}.id`);
  return id;
}

function normalizeResumeNotification(
  message: CodexServerMessage,
  session: CodexSessionState,
): CodexServerMessage {
  if (!session.resumed || message.method !== "thread/started") return message;
  session.resumed = false;
  return { ...message, method: "thread/resumed" };
}

function isCompletedTurn(message: CodexServerMessage, turnId: string): boolean {
  if (message.method !== "turn/completed") return false;
  const params = record(message.params);
  return scalar(record(params?.turn)?.id) === turnId;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function scalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}
