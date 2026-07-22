import path from "node:path";
import {
  canonicalEventSchema,
  type CanonicalEvent,
  type CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";

type NativeRecord = Record<string, unknown>;

export type AgyHookName =
  "PreInvocation" | "PreToolUse" | "PostToolUse" | "Stop";

interface AgyCommonHook {
  hookName: AgyHookName;
  conversationId: string;
  workspacePaths: string[];
  transcriptPath: string;
  artifactDirectoryPath: string;
  native: NativeRecord;
}

interface AgyPreInvocationHook extends AgyCommonHook {
  hookName: "PreInvocation";
  invocationNum: number;
  initialNumSteps: number;
}

interface AgyPreToolHook extends AgyCommonHook {
  hookName: "PreToolUse";
  stepIdx: number;
  toolCall: {
    name: string;
    args: NativeRecord;
  };
}

interface AgyPostToolHook extends AgyCommonHook {
  hookName: "PostToolUse";
  stepIdx: number;
  error?: string;
}

interface AgyStopHook extends AgyCommonHook {
  hookName: "Stop";
  executionNum: number;
  fullyIdle: boolean;
  terminationReason: string;
  error?: string;
}

export type ParsedAgyHook =
  AgyPreInvocationHook | AgyPreToolHook | AgyPostToolHook | AgyStopHook;

export interface AgyTranscriptLine {
  stepIndex: number;
  source: string;
  type: string;
  status: string;
  createdAt: string;
  content?: unknown;
  native: NativeRecord;
}

export interface AgyHookProjectionContext {
  taskId: TaskId;
  laneId: LaneId;
  runId: RunId;
  createEventId: (sequence: number) => string;
  now?: () => string;
  resumed?: boolean;
}

const HOOK_NAMES = new Set<string>([
  "PreInvocation",
  "PreToolUse",
  "PostToolUse",
  "Stop",
]);

export function parseAgyHook(
  hookName: string,
  payload: unknown,
): ParsedAgyHook | undefined {
  if (!HOOK_NAMES.has(hookName)) return undefined;
  const native = requireRecord(payload, `AGY ${hookName} payload`);
  const common = {
    hookName: hookName as AgyHookName,
    conversationId: requireString(native.conversationId, "conversationId"),
    workspacePaths: requireAbsolutePaths(native.workspacePaths),
    transcriptPath: requireAbsolutePath(
      native.transcriptPath,
      "transcriptPath",
    ),
    artifactDirectoryPath: requireAbsolutePath(
      native.artifactDirectoryPath,
      "artifactDirectoryPath",
    ),
    native,
  };

  if (hookName === "PreInvocation") {
    return {
      ...common,
      hookName,
      invocationNum: requireNonNegativeInteger(
        native.invocationNum,
        "invocationNum",
      ),
      initialNumSteps: requireNonNegativeInteger(
        native.initialNumSteps,
        "initialNumSteps",
      ),
    };
  }
  if (hookName === "PreToolUse") {
    const toolCall = requireRecord(native.toolCall, "AGY toolCall");
    return {
      ...common,
      hookName,
      stepIdx: requireNonNegativeInteger(native.stepIdx, "stepIdx"),
      toolCall: {
        name: requireString(toolCall.name, "toolCall.name"),
        args: requireRecord(toolCall.args, "AGY toolCall.args"),
      },
    };
  }
  if (hookName === "PostToolUse") {
    const error = optionalString(native.error, "error");
    return {
      ...common,
      hookName,
      stepIdx: requireNonNegativeInteger(native.stepIdx, "stepIdx"),
      ...(error === undefined ? {} : { error }),
    };
  }
  if (typeof native.fullyIdle !== "boolean") {
    throw new Error("AGY Stop fullyIdle must be a boolean");
  }
  const terminationReason = requireString(
    native.terminationReason,
    "terminationReason",
  );
  const error = optionalString(native.error, "error");
  return {
    ...common,
    hookName: "Stop",
    executionNum: requireNonNegativeInteger(
      native.executionNum,
      "executionNum",
    ),
    fullyIdle: native.fullyIdle,
    terminationReason,
    ...(error === undefined ? {} : { error }),
  };
}

export function parseAgyTranscriptLine(payload: unknown): AgyTranscriptLine {
  const native = requireRecord(payload, "AGY transcript line");
  const createdAt = requireString(native.created_at, "created_at");
  if (
    !/T/u.test(createdAt) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/u.test(createdAt) ||
    Number.isNaN(new Date(createdAt).getTime())
  ) {
    throw new Error("AGY transcript created_at must be an offset datetime");
  }
  return {
    stepIndex: requireNonNegativeInteger(native.step_index, "step_index"),
    source: requireString(native.source, "source"),
    type: requireString(native.type, "type"),
    status: requireString(native.status, "status"),
    createdAt,
    ...(Object.hasOwn(native, "content") ? { content: native.content } : {}),
    native,
  };
}

export class AgyHookProjector {
  private sequence = 0;
  private sessionEmitted = false;
  private conversationId: string | undefined;
  private pendingTerminal: AgyStopHook | undefined;
  private readonly tools = new Map<
    string,
    { toolName: string; input: NativeRecord }
  >();
  private readonly now: () => string;

  constructor(private readonly context: AgyHookProjectionContext) {
    this.now = context.now ?? (() => new Date().toISOString());
  }

  project(hookName: string, payload: unknown): CanonicalEvent[] {
    const hook = parseAgyHook(hookName, payload);
    if (!hook) return [];
    if (this.conversationId && this.conversationId !== hook.conversationId) {
      throw new Error("AGY hook conversationId changed during the run");
    }
    this.conversationId ??= hook.conversationId;
    const events: CanonicalEvent[] = [];
    if (!this.sessionEmitted) {
      events.push(
        this.event(
          this.context.resumed ? "session_resumed" : "session_started",
          hook,
          hook.conversationId,
          { nativeSessionId: hook.conversationId, native: hook.native },
        ),
      );
      this.sessionEmitted = true;
    }

    if (hook.hookName === "PreToolUse") {
      const toolUseId = `${hook.conversationId}:${hook.stepIdx}`;
      const metadata = {
        toolName: normalizeAgyToolName(hook.toolCall.name),
        input: rendererToolInput(hook.toolCall.name, hook.toolCall.args),
      };
      this.tools.set(toolUseId, metadata);
      events.push(
        this.event("tool_call_started", hook, toolUseId, {
          toolUseId,
          ...metadata,
          native: hook.native,
        }),
      );
    } else if (hook.hookName === "PostToolUse") {
      const completion = this.postToolEvent(hook);
      if (completion) events.push(completion);
    } else if (hook.hookName === "Stop" && hook.fullyIdle) {
      // The native Stop can arrive before the process closes stdout. Keep it
      // pending so the final assistant message always precedes the terminal.
      this.pendingTerminal = hook;
    }
    return events;
  }

  completeStdout(stdout: string, includeTerminal = true): CanonicalEvent[] {
    const events: CanonicalEvent[] = [];
    if (stdout) {
      events.push(
        this.syntheticEvent("message_completed", "stdout", {
          text: stdout,
        }),
      );
    }
    if (this.pendingTerminal && includeTerminal) {
      const hook = this.pendingTerminal;
      this.pendingTerminal = undefined;
      events.push(
        this.event(
          isFailedStop(hook) ? "run_failed" : "run_completed",
          hook,
          hook.conversationId,
          {
            ...(hook.error ? { error: hook.error } : {}),
            terminationReason: hook.terminationReason,
            native: hook.native,
          },
        ),
      );
    }
    return events;
  }

  projectApprovalRequested(
    hook: AgyPreToolHook,
    approval: {
      approvalId: string;
      capability: string;
      resource: string;
      risk: string;
    },
  ): CanonicalEvent {
    return this.event("approval_requested", hook, approval.approvalId, {
      ...approval,
      native: hook.native,
    });
  }

  discardPendingTerminal(): void {
    this.pendingTerminal = undefined;
  }

  projectFailure(reason: string): CanonicalEvent {
    return this.syntheticEvent("run_failed", "failure", { reason });
  }

  projectCompletion(reason: string): CanonicalEvent {
    return this.syntheticEvent("run_completed", "completion", { reason });
  }

  projectCancellation(): CanonicalEvent {
    return this.syntheticEvent("run_cancelled", "cancelled", {
      reason: "user_cancelled",
    });
  }

  get hasPendingTerminal(): boolean {
    return this.pendingTerminal !== undefined;
  }

  private postToolEvent(hook: AgyPostToolHook): CanonicalEvent | undefined {
    const toolUseId = `${hook.conversationId}:${hook.stepIdx}`;
    const metadata = this.tools.get(toolUseId);
    const error = nonEmpty(hook.error);
    // AGY 1.1.5 emits empty PostToolUse bookkeeping around a response even
    // when terminationReason is NO_TOOL_CALL. Without a matching PreToolUse,
    // this is not a tool lifecycle and must not poison read-only consumers.
    if (!metadata && error === undefined) return undefined;
    return this.event("tool_call_completed", hook, toolUseId, {
      toolUseId,
      ...(metadata ?? {}),
      isError: error !== undefined,
      ...(error === undefined ? {} : { output: error }),
      native: hook.native,
    });
  }

  private event(
    kind: CanonicalEventKind,
    hook: ParsedAgyHook,
    nativeAnchor: string,
    payload: NativeRecord,
  ): CanonicalEvent {
    const sequence = this.sequence++;
    return canonicalEventSchema.parse({
      schemaVersion: 1,
      id: this.context.createEventId(sequence),
      taskId: this.context.taskId,
      laneId: this.context.laneId,
      runId: this.context.runId,
      sequence,
      occurredAt: this.now(),
      kind,
      nativeEventId: `agy:${this.context.runId}:${hook.hookName}:${nativeAnchor}:${sequence}`,
      payload: { runtime: "agy", ...payload },
    });
  }

  private syntheticEvent(
    kind: CanonicalEventKind,
    anchor: string,
    payload: NativeRecord,
  ): CanonicalEvent {
    const sequence = this.sequence++;
    return canonicalEventSchema.parse({
      schemaVersion: 1,
      id: this.context.createEventId(sequence),
      taskId: this.context.taskId,
      laneId: this.context.laneId,
      runId: this.context.runId,
      sequence,
      occurredAt: this.now(),
      kind,
      nativeEventId: `agy:${this.context.runId}:${anchor}:${sequence}`,
      payload: { runtime: "agy", ...payload },
    });
  }
}

function normalizeAgyToolName(toolName: string): string {
  const known: Record<string, string> = {
    run_command: "Bash",
    view_file: "Read",
    read_file: "Read",
    write_to_file: "Write",
    write_file: "Write",
    replace_file_content: "Edit",
    replace_in_file: "Edit",
    multi_replace_file_content: "Edit",
    grep_search: "Grep",
    find_by_name: "Glob",
    find_files: "Glob",
    list_dir: "Glob",
    search_web: "WebSearch",
    web_search: "WebSearch",
    read_url_content: "WebFetch",
    fetch_url: "WebFetch",
  };
  return known[toolName] ?? readableToolName(toolName);
}

function rendererToolInput(toolName: string, args: NativeRecord): NativeRecord {
  const input = { ...args };
  if (toolName === "run_command") {
    addStringAlias(input, args, "CommandLine", "command");
    addStringAlias(input, args, "Cwd", "cwd");
  }
  if (toolName === "view_file" || toolName === "read_file") {
    addStringAlias(input, args, "AbsolutePath", "file_path");
  }
  if (
    toolName === "write_to_file" ||
    toolName === "write_file" ||
    toolName === "replace_file_content" ||
    toolName === "replace_in_file" ||
    toolName === "multi_replace_file_content"
  ) {
    addStringAlias(input, args, "TargetFile", "file_path");
    addStringAlias(input, args, "CodeContent", "content");
    addStringAlias(input, args, "TargetContent", "old_string");
    addStringAlias(input, args, "ReplacementContent", "new_string");
  }
  if (toolName === "read_url_content" || toolName === "fetch_url") {
    addStringAlias(input, args, "Url", "url");
  }
  return input;
}

function addStringAlias(
  target: NativeRecord,
  source: NativeRecord,
  officialName: string,
  alias: string,
): void {
  if (typeof source[officialName] === "string") {
    target[alias] = source[officialName];
  }
}

function readableToolName(toolName: string): string {
  return toolName
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function isFailedStop(hook: AgyStopHook): boolean {
  if (nonEmpty(hook.error)) return true;
  const reason = hook.terminationReason.trim().toLowerCase();
  return (
    reason === "error" ||
    reason === "max_steps" ||
    reason === "max-step" ||
    reason === "max_steps_exceeded"
  );
}

function requireAbsolutePaths(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || !path.isAbsolute(entry))
  ) {
    throw new Error("AGY workspacePaths must contain absolute paths");
  }
  return [...value] as string[];
}

function requireAbsolutePath(value: unknown, field: string): string {
  const candidate = requireString(value, field);
  if (!path.isAbsolute(candidate)) {
    throw new Error(`AGY ${field} must be an absolute path`);
  }
  return candidate;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`AGY ${field} must be a non-negative integer`);
  }
  return value as number;
}

function requireString(value: unknown, field: string): string {
  const candidate = nonEmpty(value);
  if (!candidate) throw new Error(`AGY ${field} must be a non-empty string`);
  return candidate;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`AGY ${field} must be a string when present`);
  }
  return value;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requireRecord(value: unknown, field: string): NativeRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as NativeRecord;
}
