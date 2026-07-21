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
import { cursorArgs } from "./command";
import { CursorProjector, cursorSessionIdFromInit } from "./projector";

type NativeRecord = Record<string, unknown>;

interface ExecuteResult {
  stdout: string;
  stderr?: string;
}

interface CursorProcess {
  next(): Promise<NativeRecord | undefined>;
  wait(): Promise<ProcessWaitResult>;
  cancel(): Promise<void>;
}

export interface CursorAdapterDependencies {
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  execute?: (
    command: string,
    args: string[],
    options?: JsonlProcessOptions,
  ) => Promise<ExecuteResult>;
  spawn?: (
    command: string,
    args: string[],
    options?: JsonlProcessOptions,
  ) => Promise<CursorProcess>;
  command?: string;
  env?: NodeJS.ProcessEnv;
  createEventId?: (sequence: number) => string;
}

interface CursorSessionState {
  laneId: NativeSession["laneId"];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  permissionMode?: string;
  runtimeVersion: string;
}

interface ActiveCursorRun {
  process: CursorProcess;
  cancelRequested: boolean;
  terminalProjected: boolean;
}

const REQUIRED_HELP_TOKENS = [
  "--print",
  "--output-format",
  "stream-json",
  "--stream-partial-output",
  "--resume",
  "--mode",
  "--auto-review",
  "--sandbox",
] as const;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

export class CursorAdapter implements RuntimeAdapter {
  readonly kind = "cursor" as const;
  private readonly sessions = new Map<string, CursorSessionState>();
  private readonly activeRuns = new Map<
    NativeTurnRequest["runId"],
    ActiveCursorRun
  >();

  constructor(private readonly dependencies: CursorAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    const command = this.dependencies.command ?? "cursor-agent";
    const execute = this.dependencies.execute ?? executeFile;
    let version: string | null = null;
    try {
      const result = await execute(command, ["--version"]);
      version =
        result.stdout.match(
          /\b(\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?)\b/u,
        )?.[1] ?? null;
    } catch (error) {
      return {
        available: false,
        protocolSupported: false,
        version: null,
        detail: errorMessage(error),
      };
    }
    if (!version) {
      return {
        available: true,
        protocolSupported: false,
        version: null,
        detail: "Cursor version output did not contain a semantic version",
      };
    }

    try {
      const help = await execute(command, ["--help"]);
      const createChatHelp = await execute(command, ["create-chat", "--help"]);
      const missing: string[] = REQUIRED_HELP_TOKENS.filter(
        (token) => !help.stdout.includes(token),
      );
      if (!createChatHelp.stdout.includes("create-chat")) {
        missing.push("create-chat");
      }
      return missing.length === 0
        ? { available: true, protocolSupported: true, version }
        : {
            available: true,
            protocolSupported: false,
            version,
            detail: `Cursor CLI is missing required capabilities: ${missing.join(", ")}`,
          };
    } catch (error) {
      return {
        available: true,
        protocolSupported: false,
        version,
        detail: errorMessage(error),
      };
    }
  }

  async start(request: StartSessionRequest): Promise<NativeSession> {
    const health = await this.requireProtocol();
    const execute = this.dependencies.execute ?? executeFile;
    const result = await execute(
      this.dependencies.command ?? "cursor-agent",
      ["create-chat"],
      processOptions(request.cwd, request.env ?? this.dependencies.env),
    );
    const nativeSessionId = result.stdout.trim();
    if (!SESSION_ID.test(nativeSessionId)) {
      throw new Error("Cursor create-chat returned an invalid session id");
    }
    return this.recordSession(request, nativeSessionId, health.version);
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    const health = await this.requireProtocol();
    if (!SESSION_ID.test(request.nativeSessionId)) {
      throw new Error("Cursor resume requires a valid session id");
    }
    return this.recordSession(request, request.nativeSessionId, health.version);
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    if (request.nativeSessionId === null) {
      throw new Error("Cursor requires an authoritative native session id");
    }
    const session = this.sessions.get(request.nativeSessionId);
    if (!session) {
      throw new Error(`Unknown Cursor session ${request.nativeSessionId}`);
    }
    if (session.laneId !== request.laneId) {
      throw new Error("Cursor session does not belong to the requested lane");
    }
    if (this.activeRuns.has(request.runId)) {
      throw new Error(`Cursor run ${request.runId} is already active`);
    }

    const args = cursorArgs({
      prompt: request.input,
      model: request.model ?? session.model,
      resumeId: request.nativeSessionId,
      permissionMode: session.permissionMode,
    });
    const taskId = await this.dependencies.taskIdForRun(request.runId);
    const spawn =
      this.dependencies.spawn ??
      ((command, args, options) =>
        JsonlProcess.spawn<NativeRecord>(command, args, options));
    const process = await spawn(
      this.dependencies.command ?? "cursor-agent",
      args,
      processOptions(session.cwd, session.env),
    );
    const run: ActiveCursorRun = {
      process,
      cancelRequested: false,
      terminalProjected: false,
    };
    this.activeRuns.set(request.runId, run);
    const projector = new CursorProjector({
      taskId,
      laneId: request.laneId,
      runId: request.runId,
      createEventId: this.dependencies.createEventId ?? (() => randomUUID()),
      resumed: true,
    });
    return {
      runId: request.runId,
      events: this.projectRunEvents(request, run, projector),
    };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    void response;
    throw new Error("Cursor approvals are not supported");
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run || run.cancelRequested || run.terminalProjected) return;
    run.cancelRequested = true;
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
      throw new Error(health.detail ?? "Cursor CLI protocol is unavailable");
    }
    return { version: health.version };
  }

  private recordSession(
    request: StartSessionRequest,
    nativeSessionId: string,
    runtimeVersion: string,
  ): NativeSession {
    this.sessions.set(nativeSessionId, {
      laneId: request.laneId,
      cwd: request.cwd,
      env: request.env ?? this.dependencies.env,
      model: request.model,
      permissionMode: request.permissionMode,
      runtimeVersion,
    });
    return {
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId,
      runtimeVersion,
    };
  }

  private async *projectRunEvents(
    request: NativeTurnRequest,
    run: ActiveCursorRun,
    projector: CursorProjector,
  ): AsyncIterable<ReturnType<CursorProjector["project"]>[number]> {
    let sawInit = false;
    let sawTerminal = false;
    const { process } = run;
    try {
      for (;;) {
        const message = await process.next();
        if (!message) break;
        const nativeSessionId = cursorSessionIdFromInit(message);
        if (nativeSessionId) {
          sawInit = true;
          if (nativeSessionId !== request.nativeSessionId) {
            throw new Error(
              "Cursor system/init session_id does not match the resumed session",
            );
          }
        } else if (!sawInit) {
          throw new Error("Cursor stream emitted output before system/init");
        }
        for (const event of projector.project(message)) {
          if (event.kind === "run_completed" || event.kind === "run_failed") {
            if (run.cancelRequested) continue;
            sawTerminal = true;
            run.terminalProjected = true;
          }
          yield event;
        }
      }
      const processResult = await process.wait();
      if (run.cancelRequested) {
        run.terminalProjected = true;
        yield projector.projectCancellation({
          type: "process_cancelled",
          expectedSessionId: request.nativeSessionId,
          processResult,
        });
      } else if (!sawTerminal) {
        run.terminalProjected = true;
        yield projector.projectProcessFailure({
          type: "process_failure",
          expectedSessionId: request.nativeSessionId,
          sawInit,
          processResult,
        });
      }
    } catch (error) {
      try {
        await process.cancel();
      } finally {
        await process.wait();
      }
      throw error;
    } finally {
      this.activeRuns.delete(request.runId);
    }
  }
}

function processOptions(
  cwd: string,
  env?: NodeJS.ProcessEnv,
): JsonlProcessOptions {
  return env ? { cwd, env } : { cwd };
}

function executeFile(
  command: string,
  args: string[],
  options?: JsonlProcessOptions,
): Promise<ExecuteResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
