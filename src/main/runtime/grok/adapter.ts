import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  JsonlProcess,
  type JsonlProcessOptions,
  type ProcessWaitResult,
} from "../transport";
import { grokArgs } from "./command";
import { GrokProjector } from "./projector";

type NativeRecord = Record<string, unknown>;

interface GrokProcess {
  next(): Promise<NativeRecord | undefined>;
  wait(): Promise<ProcessWaitResult>;
  cancel(): Promise<void>;
}

export interface GrokAdapterDependencies {
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  command?: string;
  env?: NodeJS.ProcessEnv;
  execute?: (
    command: string,
    args: string[],
    options?: JsonlProcessOptions,
  ) => Promise<{ stdout: string; stderr?: string }>;
  spawn?: (
    command: string,
    args: string[],
    options?: JsonlProcessOptions,
  ) => Promise<GrokProcess>;
  createEventId?: (sequence: number) => string;
}

interface SessionState {
  laneId: NativeSession["laneId"];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  permissionMode?: string;
  runtimeVersion: string;
  hasTurns: boolean;
}

export class GrokAdapter implements RuntimeAdapter {
  readonly kind = "grok" as const;
  private readonly sessions = new Map<string, SessionState>();
  private readonly active = new Map<
    NativeTurnRequest["runId"],
    { process: GrokProcess; cancelled: boolean }
  >();

  constructor(private readonly dependencies: GrokAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    const command = this.dependencies.command ?? "grok";
    const execute = this.dependencies.execute ?? executeFile;
    try {
      const versionResult = await execute(command, ["--version"]);
      const version =
        versionResult.stdout.match(/\b\d+\.\d+\.\d+\b/u)?.[0] ?? null;
      const help = await execute(command, ["--help"]);
      const required = ["streaming-json", "--resume", "--session-id", "models"];
      const missing = required.filter((token) => !help.stdout.includes(token));
      return missing.length === 0
        ? { available: true, protocolSupported: true, version }
        : {
            available: true,
            protocolSupported: false,
            version,
            detail: `Grok CLI is missing: ${missing.join(", ")}`,
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
    return this.record(request, randomUUID(), health.version, false);
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    const health = await this.requireProtocol();
    return this.record(request, request.nativeSessionId, health.version, true);
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    if (!request.nativeSessionId)
      throw new Error("Grok requires a native session id");
    const session = this.sessions.get(request.nativeSessionId);
    if (!session || session.laneId !== request.laneId)
      throw new Error("Unknown Grok session");
    if (this.active.has(request.runId))
      throw new Error(`Grok run ${request.runId} is already active`);
    const spawn =
      this.dependencies.spawn ??
      ((command, args, options) =>
        JsonlProcess.spawn<NativeRecord>(command, args, options));
    const process = await spawn(
      this.dependencies.command ?? "grok",
      grokArgs({
        prompt: request.input,
        sessionId: request.nativeSessionId,
        resume: session.hasTurns,
        model: request.model ?? session.model,
        effort: request.effort,
        permissionMode: session.permissionMode,
      }),
      session.env
        ? { cwd: session.cwd, env: session.env }
        : { cwd: session.cwd },
    );
    const run = { process, cancelled: false };
    this.active.set(request.runId, run);
    const projector = new GrokProjector({
      taskId: await this.dependencies.taskIdForRun(request.runId),
      laneId: request.laneId,
      runId: request.runId,
      nativeSessionId: request.nativeSessionId,
      createEventId: this.dependencies.createEventId ?? (() => randomUUID()),
    });
    return {
      runId: request.runId,
      events: this.events(request, session, run, projector),
    };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    void response;
    throw new Error(
      "Grok interactive approvals are not exposed by streaming-json",
    );
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    const run = this.active.get(runId);
    if (!run || run.cancelled) return;
    run.cancelled = true;
    await run.process.cancel();
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: false,
      contextSnapshot: false,
      activitySnapshot: false,
    };
  }

  private async requireProtocol(): Promise<{ version: string }> {
    const health = await this.detect();
    if (!health.available || !health.protocolSupported || !health.version) {
      throw new Error(health.detail ?? "Grok CLI protocol is unavailable");
    }
    return { version: health.version };
  }

  private record(
    request: StartSessionRequest,
    id: string,
    version: string,
    hasTurns: boolean,
  ): NativeSession {
    this.sessions.set(id, {
      laneId: request.laneId,
      cwd: request.cwd,
      env: request.env ?? this.dependencies.env,
      model: request.model,
      permissionMode: request.permissionMode,
      runtimeVersion: version,
      hasTurns,
    });
    return {
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId: id,
      runtimeVersion: version,
    };
  }

  private async *events(
    request: NativeTurnRequest,
    session: SessionState,
    run: { process: GrokProcess; cancelled: boolean },
    projector: GrokProjector,
  ) {
    let terminal = false;
    try {
      yield projector.sessionEvent();
      for (;;) {
        const message = await run.process.next();
        if (!message) break;
        // Once Grok emitted native output the session exists and subsequent
        // turns must resume it. A process that dies before output can safely
        // retry the original new-session command.
        session.hasTurns = true;
        for (const event of projector.project(message)) {
          if (event.kind === "run_completed" || event.kind === "run_failed")
            terminal = true;
          yield event;
        }
      }
      const result = await run.process.wait();
      if (run.cancelled)
        yield projector.cancelled({ type: "cancelled", result });
      else if (!terminal)
        yield projector.failed({ type: "process_failure", result });
    } finally {
      this.active.delete(request.runId);
    }
  }
}

function executeFile(
  command: string,
  args: string[],
  options?: JsonlProcessOptions,
): Promise<{ stdout: string; stderr?: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) =>
      error
        ? reject(error)
        : resolve({ stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
