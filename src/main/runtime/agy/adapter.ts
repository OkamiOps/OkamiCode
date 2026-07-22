import { spawn as spawnChild, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { CanonicalEvent } from "../../../shared/contracts/event";
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
import { agyTurnArgs } from "./command";
import { AgyCompanionIngress } from "./companion-ingress";
import { parseAgyHook, type ParsedAgyHook } from "./hook-contract";

const execFileAsync = promisify(execFile);
const MAX_STDOUT_BYTES = 1024 * 1024;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const REQUIRED_HELP_TOKENS = [
  "--print",
  "--conversation",
  "--add-dir",
  "--sandbox",
] as const;

export interface AgyProcessResult {
  exitCode: number;
  stdout: string;
  stdoutExceeded?: boolean;
}

export interface AgyProcess {
  wait(): Promise<AgyProcessResult>;
  cancel(): Promise<void>;
}

export interface AgyCompanion {
  start(): Promise<void>;
  hookEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  close(): Promise<void>;
}

export interface AgyTurnAuthorizer {
  authorize(context: {
    runId: NativeTurnRequest["runId"];
    laneId: NativeTurnRequest["laneId"];
    hook: ParsedAgyHook;
    onApprovalRequested?: (approval: AgyApprovalRequest) => boolean;
  }): Promise<"allow" | "deny">;
  completeRun?(runId: NativeTurnRequest["runId"]): void;
}

export interface AgyApprovalRequest {
  approvalId: string;
  capability: string;
  resource: string;
  risk: string;
}

export interface AgyAdapterDependencies {
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  authorizer:
    | AgyTurnAuthorizer
    | ((
        context: Parameters<AgyTurnAuthorizer["authorize"]>[0],
      ) => Promise<"allow" | "deny">);
  execute?: (
    command: string,
    args: string[],
  ) => Promise<{ stdout?: string; stderr?: string }>;
  spawn?: (
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => Promise<AgyProcess>;
  pluginStatus: () => Promise<"absent" | "enabled" | "disabled">;
  companionFactory: (
    onHook: (envelope: {
      hookName: string;
      payload: unknown;
    }) => Promise<{ decision: "allow" | "deny" } | undefined>,
  ) => AgyCompanion;
  command?: string;
  env?: NodeJS.ProcessEnv;
  createEventId?: (sequence: number) => string;
}

interface AgySessionState {
  laneId: NativeSession["laneId"];
  cwd: string;
  env: NodeJS.ProcessEnv;
  model?: string;
  permissionMode?: string;
  nativeSessionId: string | null;
  runtimeVersion: string;
  resumed: boolean;
}

interface ActiveAgyRun {
  laneId: NativeTurnRequest["laneId"];
  process: AgyProcess;
  companion: AgyCompanion;
  ingress: AgyCompanionIngress;
  session: AgySessionState;
  cancelled: boolean;
  protocolFailure?: string;
}

export class EventQueue implements AsyncIterable<CanonicalEvent> {
  private static readonly maximumEvents = 1_024;
  private readonly values: CanonicalEvent[] = [];
  private readonly waiters: Array<
    (value: IteratorResult<CanonicalEvent>) => void
  > = [];
  private done = false;
  private terminalPushed = false;

  push(event: CanonicalEvent): boolean {
    if (this.done || this.values.length >= EventQueue.maximumEvents)
      return false;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.values.push(event);
    return true;
  }

  pushTerminal(event: CanonicalEvent): boolean {
    if (this.done || this.terminalPushed) return false;
    this.terminalPushed = true;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return true;
    }
    if (this.values.length >= EventQueue.maximumEvents) {
      const nonTerminal = this.values.findIndex(
        (candidate) => !isTerminal(candidate),
      );
      if (nonTerminal >= 0) this.values.splice(nonTerminal, 1);
      else this.values.shift();
    }
    this.values.push(event);
    return true;
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CanonicalEvent> {
    return {
      next: () => {
        const event = this.values.shift();
        if (event) return Promise.resolve({ value: event, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export class AgyAdapter implements RuntimeAdapter {
  readonly kind = "agy" as const;
  private readonly sessionsByLane = new Map<string, AgySessionState>();
  private readonly activeRuns = new Map<
    NativeTurnRequest["runId"],
    ActiveAgyRun
  >();
  private readonly activeLanes = new Set<string>();
  private readonly reservedRuns = new Set<string>();

  constructor(private readonly dependencies: AgyAdapterDependencies) {}

  async detect(): Promise<RuntimeHealth> {
    const execute = this.dependencies.execute ?? executeAgy;
    const command = this.dependencies.command ?? "agy";
    let version: string | null;
    try {
      const result = await execute(command, ["--version"]);
      version = semanticVersion(result.stdout);
    } catch (error) {
      return unavailable(error);
    }
    if (!version) {
      return {
        available: true,
        protocolSupported: false,
        version: null,
        detail: "AGY version output did not contain a semantic version",
      };
    }
    try {
      const [help, plugin] = await Promise.all([
        execute(command, ["--help"]),
        this.dependencies.pluginStatus(),
      ]);
      const helpText = `${String(help.stdout ?? "")}\n${String(help.stderr ?? "")}`;
      const missing: string[] = REQUIRED_HELP_TOKENS.filter(
        (token) => !helpText.includes(token),
      );
      if (plugin !== "enabled") missing.push("okami-agy-companion");
      return missing.length === 0
        ? { available: true, protocolSupported: true, version }
        : {
            available: true,
            protocolSupported: false,
            version,
            detail: `AGY CLI is missing required capabilities: ${missing.join(", ")}`,
          };
    } catch (error) {
      return {
        available: true,
        protocolSupported: false,
        version,
        detail: safeError(error),
      };
    }
  }

  async start(request: StartSessionRequest): Promise<NativeSession> {
    const health = await this.requireProtocol();
    const state = this.recordSession(request, health.version, null, false);
    return {
      laneId: state.laneId,
      bindingState: "deferred",
      nativeSessionId: null,
      runtimeVersion: state.runtimeVersion,
    };
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    if (!SESSION_ID.test(request.nativeSessionId)) {
      throw new Error("AGY resume requires a valid native session id");
    }
    const health = await this.requireProtocol();
    const state = this.recordSession(
      request,
      health.version,
      request.nativeSessionId,
      true,
    );
    return {
      laneId: state.laneId,
      bindingState: "authoritative",
      nativeSessionId: request.nativeSessionId,
      runtimeVersion: state.runtimeVersion,
    };
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    const session = this.sessionsByLane.get(request.laneId);
    if (!session) throw new Error("Unknown AGY lane session");
    if (request.nativeSessionId !== session.nativeSessionId) {
      throw new Error(
        "AGY native session does not belong to the requested lane",
      );
    }
    if (
      this.activeRuns.has(request.runId) ||
      this.reservedRuns.has(request.runId)
    ) {
      throw new Error(`AGY run ${request.runId} is already active`);
    }
    if (this.activeLanes.has(request.laneId)) {
      throw new Error("AGY lane already has an active run");
    }

    this.reservedRuns.add(request.runId);
    this.activeLanes.add(request.laneId);
    let companion: AgyCompanion | undefined;
    try {
      const taskId = await this.dependencies.taskIdForRun(request.runId);
      const queue = new EventQueue();
      const runHolder: { run?: ActiveAgyRun } = {};
      companion = this.dependencies.companionFactory(async (envelope) => {
        if (!runHolder.run) return { decision: "deny" };
        return this.receiveHook(runHolder.run, request, envelope, queue);
      });
      const ingress = new AgyCompanionIngress({
        taskId,
        laneId: request.laneId,
        runId: request.runId,
        createEventId: this.dependencies.createEventId ?? (() => randomUUID()),
        resumed: session.nativeSessionId !== null,
      });
      const run: ActiveAgyRun = {
        laneId: request.laneId,
        process: {
          wait: async () => ({ exitCode: 1, stdout: "" }),
          cancel: async () => undefined,
        },
        companion,
        ingress,
        session,
        cancelled: false,
      };
      runHolder.run = run;
      await companion.start();
      const args = agyTurnArgs({
        workspacePath: session.cwd,
        ...(session.nativeSessionId
          ? { conversationId: session.nativeSessionId }
          : {}),
        model: request.model ?? session.model,
        permissionMode: session.permissionMode,
        prompt: request.input,
      });
      const process = await (this.dependencies.spawn ?? spawnAgy)(
        this.dependencies.command ?? "agy",
        args,
        {
          cwd: session.cwd,
          env: companion.hookEnvironment(session.env),
        },
      );
      run.process = process;
      this.activeRuns.set(request.runId, run);
      this.reservedRuns.delete(request.runId);
      void this.finishRun(request, run, queue);
      return { runId: request.runId, events: queue };
    } catch (error) {
      this.reservedRuns.delete(request.runId);
      this.activeLanes.delete(request.laneId);
      await companion?.close().catch(() => undefined);
      throw error;
    }
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    // The authenticated hook blocks while the repository broker observes this
    // persisted decision. There is no second AGY control channel to answer.
    void response;
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    const run = this.activeRuns.get(runId);
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
      throw new Error(health.detail ?? "AGY CLI protocol is unavailable");
    }
    return { version: health.version };
  }

  private recordSession(
    request: StartSessionRequest,
    runtimeVersion: string,
    nativeSessionId: string | null,
    resumed: boolean,
  ): AgySessionState {
    const state: AgySessionState = {
      laneId: request.laneId,
      cwd: request.cwd,
      env: subscriptionEnvironment(this.dependencies.env, request.env),
      model: request.model,
      permissionMode: request.permissionMode,
      nativeSessionId,
      runtimeVersion,
      resumed,
    };
    this.sessionsByLane.set(request.laneId, state);
    return state;
  }

  private async receiveHook(
    run: ActiveAgyRun,
    request: NativeTurnRequest,
    envelope: { hookName: string; payload: unknown },
    queue: EventQueue,
  ): Promise<{ decision: "allow" | "deny" } | undefined> {
    try {
      const hook = parseAgyHook(envelope.hookName, envelope.payload);
      if (!hook) {
        run.protocolFailure = "agy_invalid_hook";
        return { decision: "deny" };
      }
      if (!hook.workspacePaths.includes(run.session.cwd)) {
        run.protocolFailure = "agy_hook_context_mismatch";
        return { decision: "deny" };
      }
      if (
        request.nativeSessionId !== null &&
        request.nativeSessionId !== hook.conversationId
      ) {
        run.protocolFailure = "agy_hook_conversation_mismatch";
        return { decision: "deny" };
      }
      const events = run.ingress.receive(envelope);
      const conversationId = run.ingress.conversationId;
      if (!conversationId) {
        run.protocolFailure = "agy_invalid_hook";
        return { decision: "deny" };
      }
      if (run.session.nativeSessionId === null) {
        run.session.nativeSessionId = conversationId;
      }
      for (const event of events) {
        if (!queue.push(event))
          run.protocolFailure = "agy_event_queue_overflow";
      }
      if (hook.hookName !== "PreToolUse") return undefined;
      const decision = await authorize(this.dependencies.authorizer, {
        runId: request.runId,
        laneId: request.laneId,
        hook,
        onApprovalRequested: (approval) =>
          queue.push(run.ingress.projectApprovalRequested(hook, approval)),
      });
      return { decision };
    } catch {
      run.protocolFailure = "agy_invalid_hook";
      return { decision: "deny" };
    }
  }

  private async finishRun(
    request: NativeTurnRequest,
    run: ActiveAgyRun,
    queue: EventQueue,
  ): Promise<void> {
    try {
      const result = await run.process.wait();
      if (run.cancelled) {
        queue.pushTerminal(run.ingress.projectCancellation());
      } else if (result.stdoutExceeded) {
        queue.pushTerminal(
          run.ingress.projectFailure("agy_stdout_limit_exceeded"),
        );
      } else {
        const failure =
          run.protocolFailure ??
          (result.exitCode !== 0 ? "agy_process_failed" : undefined);
        const finalEvents = run.ingress.completeStdout(
          result.stdout,
          failure === undefined,
        );
        for (const event of finalEvents) {
          if (isTerminal(event)) queue.pushTerminal(event);
          else queue.push(event);
        }
        if (failure) {
          run.ingress.discardPendingTerminal();
          queue.pushTerminal(run.ingress.projectFailure(failure));
        } else if (!hasTerminal(finalEvents)) {
          if (result.stdout.trim().length > 0) {
            queue.pushTerminal(
              run.ingress.projectCompletion("agy_stdout_completed"),
            );
          } else {
            queue.pushTerminal(
              run.ingress.projectFailure("agy_process_ended_without_stop"),
            );
          }
        }
      }
    } catch {
      queue.pushTerminal(run.ingress.projectFailure("agy_process_failed"));
    } finally {
      this.activeRuns.delete(request.runId);
      this.reservedRuns.delete(request.runId);
      this.activeLanes.delete(run.laneId);
      completeAuthorizerRun(this.dependencies.authorizer, request.runId);
      await run.companion.close().catch(() => undefined);
      queue.close();
    }
  }
}

function hasTerminal(events: CanonicalEvent[]): boolean {
  return events.some(isTerminal);
}

function isTerminal(event: CanonicalEvent): boolean {
  return (
    event.kind === "run_completed" ||
    event.kind === "run_failed" ||
    event.kind === "run_cancelled"
  );
}

async function authorize(
  authorizer: AgyAdapterDependencies["authorizer"],
  context: Parameters<AgyTurnAuthorizer["authorize"]>[0],
): Promise<"allow" | "deny"> {
  const decision =
    typeof authorizer === "function"
      ? await authorizer(context)
      : await authorizer.authorize(context);
  return decision === "allow" ? "allow" : "deny";
}

function completeAuthorizerRun(
  authorizer: AgyAdapterDependencies["authorizer"],
  runId: NativeTurnRequest["runId"],
): void {
  if (typeof authorizer !== "function") authorizer.completeRun?.(runId);
}

async function executeAgy(
  command: string,
  args: string[],
): Promise<{ stdout?: string; stderr?: string }> {
  const { stdout, stderr } = await execFileAsync(command, args);
  return { stdout: String(stdout), stderr: String(stderr) };
}

async function spawnAgy(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<AgyProcess> {
  const child = spawnChild(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new ChildAgyProcess(child);
}

class ChildAgyProcess implements AgyProcess {
  private cancelled = false;
  private killed = false;
  private readonly completion: Promise<AgyProcessResult>;

  constructor(private readonly child: ReturnType<typeof spawnChild>) {
    this.completion = new Promise((resolve, reject) => {
      let bytes = 0;
      let exceeded = false;
      const chunks: Buffer[] = [];
      child.stdout?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_STDOUT_BYTES) {
          exceeded = true;
          void this.cancel();
          return;
        }
        chunks.push(chunk);
      });
      child.once("error", reject);
      child.once("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(chunks).toString("utf8"),
          stdoutExceeded: exceeded,
        });
      });
    });
    child.stderr?.resume();
  }

  wait(): Promise<AgyProcessResult> {
    return this.completion;
  }

  async cancel(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    this.child.kill("SIGTERM");
    setTimeout(() => {
      if (!this.killed && this.child.exitCode === null) {
        this.killed = true;
        this.child.kill("SIGKILL");
      }
    }, 2_000).unref();
  }
}

function semanticVersion(value: unknown): string | null {
  return typeof value === "string"
    ? (value.match(
        /\b(\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?)\b/u,
      )?.[1] ?? null)
    : null;
}

function unavailable(error: unknown): RuntimeHealth {
  return {
    available: false,
    protocolSupported: false,
    version: null,
    detail: safeError(error),
  };
}

function safeError(error: unknown): string {
  void error;
  return "AGY CLI probe failed";
}

export function subscriptionEnvironment(
  defaults: NodeJS.ProcessEnv | undefined,
  explicit: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...defaults, ...explicit };
  delete environment.OPENAI_API_KEY;
  delete environment.ANTHROPIC_API_KEY;
  delete environment.GOOGLE_API_KEY;
  delete environment.GEMINI_API_KEY;
  delete environment.CURSOR_API_KEY;
  delete environment.XAI_API_KEY;
  delete environment.GROK_API_KEY;
  delete environment.MINIMAX_API_KEY;
  delete environment.XIAOMI_API_KEY;
  return environment;
}
