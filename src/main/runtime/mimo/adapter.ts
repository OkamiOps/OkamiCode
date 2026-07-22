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
import { mimoArgs } from "./command";
import { MimoProjector } from "./projector";
import { subscriptionEnvironment } from "../agy/adapter";

type NativeRecord = Record<string, unknown>;

interface MimoProcess {
  next(): Promise<NativeRecord | undefined>;
  wait(): Promise<ProcessWaitResult>;
  cancel(): Promise<void>;
}

export interface MimoAdapterDependencies {
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
  ) => Promise<MimoProcess>;
  createEventId?: (sequence: number) => string;
  firstEventTimeoutMs?: number;
}

const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 60_000;
const FIRST_EVENT_TIMEOUT = Symbol("mimo-first-event-timeout");

interface MimoSessionState {
  laneId: NativeSession["laneId"];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  permissionMode?: string;
  runtimeVersion: string;
  nativeSessionId?: string;
}

export class MimoAdapter implements RuntimeAdapter {
  readonly kind = "mimo" as const;
  private readonly sessions = new Map<string, MimoSessionState>();
  private readonly active = new Map<
    NativeTurnRequest["runId"],
    { process: MimoProcess; cancelled: boolean }
  >();

  constructor(private readonly dependencies: MimoAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    const command = this.dependencies.command ?? "mimo";
    const execute = this.dependencies.execute ?? executeFile;
    try {
      const versionResult = await execute(command, ["--version"]);
      const version =
        versionResult.stdout.match(/\b\d+\.\d+\.\d+\b/u)?.[0] ?? null;
      const help = await execute(command, ["run", "--help"]);
      const helpText = `${help.stdout}\n${help.stderr ?? ""}`;
      const required = ["--format", "json", "--session", "--model", "--dir"];
      const missing = required.filter((token) => !helpText.includes(token));
      return missing.length === 0
        ? { available: true, protocolSupported: true, version }
        : {
            available: true,
            protocolSupported: false,
            version,
            detail: `MiMo CLI is missing required capabilities: ${missing.join(", ")}`,
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
    this.sessions.set(request.laneId, {
      laneId: request.laneId,
      cwd: request.cwd,
      env: subscriptionEnvironment(this.dependencies.env, request.env),
      model: request.model,
      permissionMode: request.permissionMode,
      runtimeVersion: version,
    });
    return {
      laneId: request.laneId,
      bindingState: "deferred",
      nativeSessionId: null,
      runtimeVersion: version,
    };
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    const { version } = await this.requireProtocol();
    this.sessions.set(request.laneId, {
      laneId: request.laneId,
      cwd: request.cwd,
      env: subscriptionEnvironment(this.dependencies.env, request.env),
      model: request.model,
      permissionMode: request.permissionMode,
      runtimeVersion: version,
      nativeSessionId: request.nativeSessionId,
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
    if (!session) throw new Error("Unknown MiMo lane session");
    if (this.active.has(request.runId)) {
      throw new Error(`MiMo run ${request.runId} is already active`);
    }
    if (
      session.nativeSessionId &&
      request.nativeSessionId !== session.nativeSessionId
    ) {
      throw new Error("MiMo native session does not belong to the lane");
    }
    if (session.permissionMode === "bypassPermissions") {
      throw new Error("MiMo permission bypass is not enabled by Okami");
    }
    const spawn =
      this.dependencies.spawn ??
      ((command, args, options) =>
        JsonlProcess.spawn<NativeRecord>(command, args, options));
    const process = await spawn(
      this.dependencies.command ?? "mimo",
      mimoArgs({
        prompt: request.input,
        cwd: session.cwd,
        model: request.model ?? session.model,
        sessionId: request.nativeSessionId ?? session.nativeSessionId,
        effort: request.effort,
      }),
      session.env
        ? { cwd: session.cwd, env: session.env, closeStdin: true }
        : { cwd: session.cwd, closeStdin: true },
    );
    const run = { process, cancelled: false };
    this.active.set(request.runId, run);
    const projector = new MimoProjector({
      taskId: await this.dependencies.taskIdForRun(request.runId),
      laneId: request.laneId,
      runId: request.runId,
      nativeSessionId: request.nativeSessionId ?? session.nativeSessionId,
      createEventId: this.dependencies.createEventId ?? (() => randomUUID()),
    });
    return {
      runId: request.runId,
      events: this.events(request, session, run, projector),
    };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    void response;
    throw new Error("MiMo interactive approvals are not exposed by JSON mode");
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
      throw new Error(health.detail ?? "MiMo CLI protocol is unavailable");
    }
    return { version: health.version };
  }

  private async *events(
    request: NativeTurnRequest,
    session: MimoSessionState,
    run: { process: MimoProcess; cancelled: boolean },
    projector: MimoProjector,
  ) {
    try {
      let receivedEvent = false;
      for (;;) {
        const message = receivedEvent
          ? await run.process.next()
          : await withTimeout(
              run.process.next(),
              this.dependencies.firstEventTimeoutMs ??
                DEFAULT_FIRST_EVENT_TIMEOUT_MS,
            );
        if (message === FIRST_EVENT_TIMEOUT) {
          try {
            await run.process.cancel();
          } catch {
            // The terminal failure still has to reach the renderer even when
            // the already-unhealthy child cannot acknowledge termination.
          }
          yield projector.failed("mimo_first_event_timeout");
          return;
        }
        if (!message) break;
        receivedEvent = true;
        for (const event of projector.project(message)) {
          if (
            (event.kind === "session_started" ||
              event.kind === "session_resumed") &&
            projector.nativeSessionId
          ) {
            session.nativeSessionId = projector.nativeSessionId;
          }
          yield event;
        }
      }
      const result = await run.process.wait();
      yield run.cancelled
        ? projector.cancelled()
        : projector.completed(result.successOrCancelled);
    } finally {
      this.active.delete(request.runId);
    }
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof FIRST_EVENT_TIMEOUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(FIRST_EVENT_TIMEOUT), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function executeFile(
  command: string,
  args: string[],
  options?: JsonlProcessOptions,
): Promise<{ stdout: string; stderr?: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
