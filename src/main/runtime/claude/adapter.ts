import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PolicyEngine } from "../../policy/engine";
import type { Capability } from "../../policy/action";
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
import type { ApprovalBroker } from "../codex/adapter";
import { JsonlProcess } from "../transport";
import {
  claudeArgs,
  claudeEnvironment,
  createClaudeSettings,
  ownedClaudeGatewayConfigDirectory,
  probeClaudeCapabilities,
  type ClaudeCapabilities,
} from "./command";
import { ClaudeHookServer, type ClaudeHookContext } from "./hook-server";
import { ClaudeProjector, claudeSessionIdFromInit } from "./projector";

type NativeRecord = Record<string, unknown>;

export interface ClaudeAdapterDependencies {
  policyEngine: Pick<PolicyEngine, "authorize">;
  approvalBroker: ApprovalBroker;
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  leaseIdsForRun: (
    runId: NativeTurnRequest["runId"],
  ) =>
    | Partial<Record<Capability, string>>
    | Promise<Partial<Record<Capability, string>>>;
  command?: string;
  env?: NodeJS.ProcessEnv;
  hookScriptPath?: string;
}

interface ClaudeSessionState {
  laneId: NativeSession["laneId"];
  launchSessionId: string;
  authoritativeSessionId?: string;
  initBinding?: Promise<string>;
  runtimeVersion: string;
  process: JsonlProcess<NativeRecord>;
  hookServer: ClaudeHookServer;
  setHookContext: (context: ClaudeHookContext | undefined) => void;
  initialMessages: NativeRecord[];
  allowedWorkspaces: string[];
  temporaryDirectory: string;
  gatewayConfigDirectory?: string;
  degraded: boolean;
  resumed: boolean;
  respawnFresh?: (sessionId: string) => Promise<JsonlProcess<NativeRecord>>;
}

interface ActiveClaudeRun {
  request: NativeTurnRequest;
  session: ClaudeSessionState;
}

export class ClaudeAdapter implements RuntimeAdapter {
  readonly kind = "claude" as const;
  private readonly sessions = new Map<string, ClaudeSessionState>();
  private readonly activeRuns = new Map<
    NativeTurnRequest["runId"],
    ActiveClaudeRun
  >();

  constructor(private readonly dependencies: ClaudeAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    const capabilities = await this.probe();
    return {
      available: capabilities.version !== null,
      protocolSupported: capabilities.supported,
      version: capabilities.version,
      detail: capabilities.detail,
    };
  }

  start(request: StartSessionRequest): Promise<NativeSession> {
    return this.openSession(request, false);
  }

  resume(request: ResumeSessionRequest): Promise<NativeSession> {
    return this.openSession(request, true);
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    const session = this.sessions.get(request.nativeSessionId);
    if (!session) {
      throw new Error(`Unknown Claude session ${request.nativeSessionId}`);
    }
    if (session.laneId !== request.laneId) {
      throw new Error("Claude session does not belong to the requested lane");
    }
    if (this.activeRuns.has(request.runId)) {
      throw new Error(`Claude run ${request.runId} is already active`);
    }

    const taskId = await this.dependencies.taskIdForRun(request.runId);
    const leaseIds = await this.dependencies.leaseIdsForRun(request.runId);
    session.setHookContext({
      taskId,
      laneId: request.laneId,
      runId: request.runId,
      leaseIds,
      allowedWorkspaces: session.allowedWorkspaces,
      degraded: session.degraded,
    });
    const run = { request, session };
    this.activeRuns.set(request.runId, run);
    const turnMessage = (sessionId: string) => ({
      type: "user",
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: request.input }],
      },
    });
    try {
      try {
        if (request.effort && request.model) {
          // Applies the picker's effort level via the CLI's own control protocol.
          await session.process.send({
            type: "control_request",
            request_id: `okami-effort-${request.runId}`,
            request: {
              subtype: "set_model",
              model: request.model,
              effort: request.effort,
            },
          });
        }
        await session.process.send(
          turnMessage(
            session.authoritativeSessionId ?? session.launchSessionId,
          ),
        );
        await this.bindAuthoritativeSessionId(session);
      } catch (error) {
        // A resumed session can die at spawn when its native conversation no
        // longer exists (e.g. gateway config recreated). Fall back to a fresh
        // session in place instead of failing the turn.
        if (!session.resumed || !session.respawnFresh) throw error;
        const freshSessionId = randomUUID();
        session.process = await session.respawnFresh(freshSessionId);
        session.resumed = false;
        session.launchSessionId = freshSessionId;
        session.authoritativeSessionId = undefined;
        session.initBinding = undefined;
        session.initialMessages.length = 0;
        this.sessions.set(freshSessionId, session);
        await session.process.send(turnMessage(freshSessionId));
        await this.bindAuthoritativeSessionId(session);
      }
    } catch (error) {
      this.activeRuns.delete(request.runId);
      session.setHookContext(undefined);
      await this.closeSession(session);
      throw error;
    }

    const projector = new ClaudeProjector({
      taskId,
      laneId: request.laneId,
      runId: request.runId,
      createEventId: () => randomUUID(),
      resumed: session.resumed,
    });
    return {
      runId: request.runId,
      events: this.projectRunEvents(run, projector),
    };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    if (!this.activeRuns.has(response.runId)) {
      throw new Error(`No active Claude run ${response.runId}`);
    }
    const resolved = await this.dependencies.approvalBroker.resolvedDecision(
      response.approvalId,
    );
    if (!resolved) {
      throw new Error(`Approval ${response.approvalId} is still pending`);
    }
    if (resolved !== response.decision) {
      throw new Error(`Approval ${response.approvalId} decision mismatch`);
    }
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    const run = this.activeRuns.get(runId);
    if (!run) return;
    this.activeRuns.delete(runId);
    run.session.setHookContext(undefined);
    await this.closeSession(run.session);
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: false,
      contextSnapshot: true,
      activitySnapshot: true,
    };
  }

  private async openSession(
    request: StartSessionRequest | ResumeSessionRequest,
    resume: boolean,
  ): Promise<NativeSession> {
    const gatewayConfigDirectory = ownedClaudeGatewayConfigDirectory(
      request.env,
    );
    let temporaryDirectory: string | undefined;
    let hookContext: ClaudeHookContext | undefined;
    let hookServer: ClaudeHookServer | undefined;
    let spawnedProcess: JsonlProcess<NativeRecord> | undefined;
    try {
      const capabilities = await this.probe();
      if (!capabilities.version) {
        throw new Error(capabilities.detail ?? "Claude CLI is unavailable");
      }
      const sessionTemporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), "okami-claude-"),
      );
      temporaryDirectory = sessionTemporaryDirectory;
      const settingsPath = path.join(
        sessionTemporaryDirectory,
        "settings.json",
      );
      const allowedWorkspaces = [path.resolve(request.cwd)];
      const sessionHookServer = new ClaudeHookServer({
        policyEngine: this.dependencies.policyEngine,
        approvalBroker: this.dependencies.approvalBroker,
        context: () => hookContext,
      });
      hookServer = sessionHookServer;
      await sessionHookServer.start();
      const settings = createClaudeSettings({
        allowedWorkspaces,
        hookScriptPath:
          this.dependencies.hookScriptPath ??
          path.resolve("bin/okami-hook.mjs"),
        degraded: capabilities.mode === "degraded",
      });
      await writeFile(settingsPath, `${JSON.stringify(settings)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      const candidateSessionId = resume
        ? (request as ResumeSessionRequest).nativeSessionId
        : randomUUID();
      const spawnSession = (binding: {
        sessionId?: string;
        resumeId?: string;
      }) =>
        JsonlProcess.spawn<NativeRecord>(
          this.dependencies.command ?? "claude",
          [
            ...claudeArgs({
              settingsPath,
              ...binding,
              model: request.model,
              permissionMode: request.permissionMode,
            }),
            // Claude 2.1.214 rejects stream-json output without this compatibility flag.
            "--verbose",
          ],
          {
            cwd: request.cwd,
            env: sessionHookServer.hookEnvironment(
              request.env ?? claudeEnvironment(this.dependencies.env),
            ),
          },
        );
      const process = await spawnSession(
        resume
          ? { resumeId: candidateSessionId }
          : { sessionId: candidateSessionId },
      );
      spawnedProcess = process;
      const initialMessages: NativeRecord[] = [];
      const state: ClaudeSessionState = {
        laneId: request.laneId,
        launchSessionId: candidateSessionId,
        runtimeVersion: capabilities.version,
        process,
        hookServer: sessionHookServer,
        setHookContext: (context) => {
          hookContext = context;
        },
        initialMessages,
        allowedWorkspaces,
        temporaryDirectory: sessionTemporaryDirectory,
        gatewayConfigDirectory,
        degraded: capabilities.mode === "degraded",
        resumed: resume,
        respawnFresh: (sessionId) => spawnSession({ sessionId }),
      };
      this.sessions.set(candidateSessionId, state);
      return {
        laneId: request.laneId,
        nativeSessionId: candidateSessionId,
        runtimeVersion: capabilities.version,
      };
    } catch (error) {
      await spawnedProcess?.cancel();
      await spawnedProcess?.wait();
      await hookServer?.close();
      await removeClaudeTemporaryDirectories(
        temporaryDirectory,
        gatewayConfigDirectory,
      );
      throw error;
    }
  }

  private async bindAuthoritativeSessionId(
    session: ClaudeSessionState,
  ): Promise<string> {
    if (session.authoritativeSessionId) {
      return session.authoritativeSessionId;
    }
    session.initBinding ??= authoritativeSessionId(
      session.process,
      session.initialMessages,
    );
    const nativeSessionId = await session.initBinding;
    const existing = this.sessions.get(nativeSessionId);
    if (existing && existing !== session) {
      throw new Error(
        `Claude system/init reused active session ${nativeSessionId}`,
      );
    }
    session.authoritativeSessionId = nativeSessionId;
    this.sessions.set(nativeSessionId, session);
    return nativeSessionId;
  }

  private async closeSession(session: ClaudeSessionState): Promise<void> {
    for (const [nativeSessionId, candidate] of this.sessions) {
      if (candidate === session) this.sessions.delete(nativeSessionId);
    }
    await session.process.cancel();
    await session.process.wait();
    await session.hookServer.close();
    await removeClaudeTemporaryDirectories(
      session.temporaryDirectory,
      session.gatewayConfigDirectory,
    );
  }

  private async *projectRunEvents(
    run: ActiveClaudeRun,
    projector: ClaudeProjector,
  ): AsyncIterable<ReturnType<ClaudeProjector["project"]>[number]> {
    try {
      for (const message of run.session.initialMessages.splice(0)) {
        for (const event of projector.project(message)) yield event;
      }
      for (;;) {
        const message = await run.session.process.next();
        if (!message) break;
        for (const event of projector.project(message)) yield event;
        if (message.type === "result") break;
      }
    } finally {
      run.session.setHookContext(undefined);
    }
  }

  private probe(): Promise<ClaudeCapabilities> {
    return probeClaudeCapabilities(
      this.dependencies.command ?? "claude",
      this.dependencies.env,
    );
  }
}

async function removeClaudeTemporaryDirectories(
  settingsDirectory: string | undefined,
  gatewayConfigDirectory: string | undefined,
): Promise<void> {
  await Promise.all(
    [settingsDirectory, gatewayConfigDirectory]
      .filter((directory): directory is string => Boolean(directory))
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

async function authoritativeSessionId(
  process: JsonlProcess<NativeRecord>,
  captured: NativeRecord[],
): Promise<string> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Timed out waiting for Claude system/init")),
      // User-level SessionStart hooks run before init and can take well over 30s.
      120_000,
    );
  });
  try {
    return await Promise.race([
      readAuthoritativeSessionId(process, captured),
      deadline,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readAuthoritativeSessionId(
  process: JsonlProcess<NativeRecord>,
  captured: NativeRecord[],
): Promise<string> {
  for (;;) {
    const message = await process.next();
    if (!message) throw new Error("Claude exited before system/init");
    captured.push(message);
    const nativeSessionId = claudeSessionIdFromInit(message);
    if (nativeSessionId) return nativeSessionId;
    if (message.type === "result") {
      throw new Error("Claude returned a result before system/init");
    }
  }
}
