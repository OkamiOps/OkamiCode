import { execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  CanonicalEvent,
  CanonicalEventKind,
} from "../../../shared/contracts/event";
import { canonicalEventSchema } from "../../../shared/contracts/event";
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
import { subscriptionEnvironment } from "../agy/adapter";
import { executableEnvironment } from "../commands";

interface ProcessResult {
  stdout: string;
  stderr: string;
  success: boolean;
}

interface MiniMaxProcess {
  result(): Promise<ProcessResult>;
  cancel(): Promise<void>;
}

interface MiniMaxSession {
  cwd: string;
  env: NodeJS.ProcessEnv;
  model?: string;
  nativeSessionId: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface MiniMaxAdapterDependencies {
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  command?: string;
  env?: NodeJS.ProcessEnv;
  execute?: (
    command: string,
    args: string[],
    options?: { env: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string; stderr?: string }>;
  run?: (
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => MiniMaxProcess;
  createEventId?: (sequence: number) => string;
}

export class MiniMaxAdapter implements RuntimeAdapter {
  readonly kind = "minimax" as const;
  private readonly sessions = new Map<string, MiniMaxSession>();
  private readonly active = new Map<string, MiniMaxProcess>();

  constructor(private readonly dependencies: MiniMaxAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    const command = this.dependencies.command ?? "mmx";
    const execute = this.dependencies.execute ?? executeFile;
    const env = executableEnvironment(
      command,
      subscriptionEnvironment(this.dependencies.env, undefined),
    );
    try {
      const versionOutput = await execute(command, ["--version"], { env });
      const version =
        versionOutput.stdout.match(/\b\d+\.\d+\.\d+\b/u)?.[0] ?? null;
      const help = await execute(command, ["text", "chat", "--help"], { env });
      const helpText = `${help.stdout}\n${help.stderr ?? ""}`;
      const required = ["--message", "--model", "--output"];
      const missing = required.filter((flag) => !helpText.includes(flag));
      return missing.length === 0
        ? { available: true, protocolSupported: true, version }
        : {
            available: true,
            protocolSupported: false,
            version,
            detail: `MiniMax mmx is missing required capabilities: ${missing.join(", ")}`,
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

  async start(request: StartSessionRequest): Promise<NativeSession> {
    const { version } = await this.requireProtocol();
    const nativeSessionId = randomUUID();
    this.sessions.set(request.laneId, {
      cwd: request.cwd,
      env: executableEnvironment(
        this.dependencies.command ?? "mmx",
        subscriptionEnvironment(this.dependencies.env, request.env),
      ),
      model: request.model,
      nativeSessionId,
      history: [],
    });
    return {
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId,
      runtimeVersion: version,
    };
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    const { version } = await this.requireProtocol();
    this.sessions.set(request.laneId, {
      cwd: request.cwd,
      env: executableEnvironment(
        this.dependencies.command ?? "mmx",
        subscriptionEnvironment(this.dependencies.env, request.env),
      ),
      model: request.model,
      nativeSessionId: request.nativeSessionId,
      history: [],
    });
    return {
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId: request.nativeSessionId,
      runtimeVersion: version,
    };
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    const session = this.sessions.get(request.laneId);
    if (!session) throw new Error("Unknown MiniMax lane session");
    if (request.nativeSessionId !== session.nativeSessionId) {
      throw new Error("MiniMax session does not belong to the lane");
    }
    const messages = [
      ...session.history,
      { role: "user" as const, text: request.input },
    ];
    const args = [
      "text",
      "chat",
      "--model",
      request.model ?? session.model ?? "MiniMax-M3",
      ...messages.flatMap((message) => [
        "--message",
        `${message.role}:${message.text}`,
      ]),
      "--output",
      "json",
      "--non-interactive",
      "--no-color",
    ];
    const process = (this.dependencies.run ?? runProcess)(
      this.dependencies.command ?? "mmx",
      args,
      { cwd: session.cwd, env: session.env },
    );
    this.active.set(request.runId, process);
    return {
      runId: request.runId,
      events: this.events(request, session, process),
    };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    void response;
    throw new Error("MiniMax mmx does not expose interactive approvals");
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    await this.active.get(runId)?.cancel();
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: true,
      contextSnapshot: false,
      activitySnapshot: false,
    };
  }

  private async requireProtocol(): Promise<{ version: string }> {
    const health = await this.detect();
    if (!health.available || !health.protocolSupported || !health.version) {
      throw new Error(health.detail ?? "MiniMax mmx protocol is unavailable");
    }
    return { version: health.version };
  }

  private async *events(
    request: NativeTurnRequest,
    session: MiniMaxSession,
    process: MiniMaxProcess,
  ): AsyncGenerator<CanonicalEvent> {
    let sequence = 0;
    const taskId = await this.dependencies.taskIdForRun(request.runId);
    const event = (
      kind: CanonicalEventKind,
      payload: Record<string, unknown>,
    ): CanonicalEvent =>
      canonicalEventSchema.parse({
        schemaVersion: 1,
        id: this.dependencies.createEventId?.(sequence) ?? randomUUID(),
        taskId,
        laneId: request.laneId,
        runId: request.runId,
        sequence: sequence++,
        occurredAt: new Date().toISOString(),
        kind,
        nativeEventId: `minimax:${request.runId}:${kind}:${sequence}`,
        payload: { runtime: "minimax", ...payload },
      });
    const build = event;
    try {
      yield build("session_resumed", {
        nativeSessionId: session.nativeSessionId,
      });
      const result = await process.result();
      if (!result.success) {
        yield build("run_failed", {
          reason: result.stderr || "minimax_process_failed",
        });
        return;
      }
      const payload = JSON.parse(result.stdout) as Record<string, unknown>;
      const text = extractText(payload);
      if (!text) {
        yield build("run_failed", {
          reason: "MiniMax returned no text",
          native: payload,
        });
        return;
      }
      session.history.push(
        { role: "user", text: request.input },
        { role: "assistant", text },
      );
      yield build("message_delta", {
        delta: text,
        messageAnchor: "assistant-0",
        native: payload,
      });
      yield build("message_completed", {
        text,
        messageAnchor: "assistant-0",
        native: payload,
      });
      if (payload.usage && typeof payload.usage === "object") {
        yield build("usage_reported", { usage: payload.usage });
      }
      yield build("run_completed", { native: payload });
    } catch (error) {
      yield build("run_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.active.delete(request.runId);
    }
  }
}

function extractText(payload: Record<string, unknown>): string | null {
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.content === "string") return payload.content;
  if (Array.isArray(payload.content)) {
    const text = payload.content
      .flatMap((item) =>
        item &&
        typeof item === "object" &&
        "text" in item &&
        typeof (item as { text?: unknown }).text === "string"
          ? [(item as { text: string }).text]
          : [],
      )
      .join("");
    return text || null;
  }
  return null;
}

function executeFile(
  command: string,
  args: string[],
  options?: { env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): MiniMaxProcess {
  let child: ChildProcess | null = null;
  const result = new Promise<ProcessResult>((resolve) => {
    child = execFile(command, args, options, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout),
        stderr: String(stderr),
        success: !error,
      });
    });
  });
  return {
    result: () => result,
    cancel: async () => {
      child?.kill("SIGTERM");
    },
  };
}
