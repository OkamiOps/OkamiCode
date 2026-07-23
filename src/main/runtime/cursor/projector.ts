import {
  canonicalEventSchema,
  type CanonicalEvent,
  type CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";

type NativeRecord = Record<string, unknown>;

export interface CursorProjectionContext {
  taskId: TaskId;
  laneId: LaneId;
  runId: RunId;
  createEventId: (sequence: number) => string;
  now?: () => string;
  resumed?: boolean;
}

export function cursorSessionIdFromInit(message: unknown): string | undefined {
  const native = record(message);
  if (native?.type !== "system" || native.subtype !== "init") {
    return undefined;
  }
  const sessionId = nonEmptyString(native.session_id);
  if (!sessionId) {
    throw new Error("Cursor system/init requires a session_id");
  }
  return sessionId;
}

export class CursorProjector {
  private sequence = 0;
  private assistantMessageOrdinal = 0;
  private readonly assistantText: string[] = [];
  private readonly now: () => string;

  constructor(private readonly context: CursorProjectionContext) {
    this.now = context.now ?? (() => new Date().toISOString());
  }

  projectAll(messages: unknown[]): CanonicalEvent[] {
    return messages.flatMap((message) => this.project(message));
  }

  project(message: unknown): CanonicalEvent[] {
    const native = record(message);
    if (!native) return [];
    if (native.type === "system") return this.projectSystem(native);
    if (native.type === "assistant") return this.projectAssistant(native);
    if (native.type === "tool_call") return this.projectToolCall(native);
    if (native.type === "result") return this.projectResult(native);
    return [];
  }

  projectProcessFailure(native: NativeRecord): CanonicalEvent {
    return this.event("run_failed", native, {
      reason: "cursor_process_ended_without_terminal_result",
      native,
    });
  }

  projectCancellation(native: NativeRecord): CanonicalEvent {
    return this.event("run_cancelled", native, {
      reason: "user_cancelled",
      native,
    });
  }

  private projectSystem(native: NativeRecord): CanonicalEvent[] {
    if (native.subtype !== "init") return [];
    const nativeSessionId = cursorSessionIdFromInit(native);
    return [
      this.event(
        this.context.resumed ? "session_resumed" : "session_started",
        native,
        { nativeSessionId, native },
      ),
    ];
  }

  private projectAssistant(native: NativeRecord): CanonicalEvent[] {
    const message = record(native.message);
    if (!message || !Array.isArray(message.content)) {
      throw new Error("Cursor assistant event requires message.content");
    }
    const textBlocks = message.content.flatMap((entry) => {
      const block = record(entry);
      if (block?.type !== "text") return [];
      if (typeof block.text !== "string") {
        throw new Error("Cursor assistant text block requires text");
      }
      return [block.text];
    });
    if (
      native.timestamp_ms === undefined &&
      textBlocks.join("") === this.assistantText.join("")
    ) {
      return [];
    }
    return textBlocks.map((text) => {
      this.assistantText.push(text);
      return [
        this.event("message_delta", native, {
          delta: text,
          messageAnchor: `assistant-${this.assistantMessageOrdinal}`,
          native,
        }),
      ][0];
    });
  }

  private projectToolCall(native: NativeRecord): CanonicalEvent[] {
    const subtype = native.subtype;
    if (subtype !== "started" && subtype !== "completed") return [];
    const callId = nonEmptyString(native.call_id);
    if (!callId) {
      throw new Error("Cursor tool_call requires a call_id");
    }
    const toolCall = record(native.tool_call);
    if (!toolCall) {
      throw new Error("Cursor tool_call requires a tool_call payload");
    }
    const toolEntry = Object.entries(toolCall).find(
      ([name, value]) =>
        isToolCallName(name) && record(value)?.args !== undefined,
    );
    const nativeTool = record(toolEntry?.[1]);
    const input = record(nativeTool?.args);
    if (!toolEntry || !nativeTool || !input) {
      throw new Error("Cursor tool_call requires a structured tool entry");
    }
    const output = textualOutput(nativeTool.result);
    if (subtype === "completed") this.assistantMessageOrdinal += 1;
    return [
      this.event(
        subtype === "started" ? "tool_call_started" : "tool_call_completed",
        native,
        {
          callId,
          toolCall,
          native,
          toolUseId: callId,
          toolName: normalizedToolName(toolEntry[0]),
          input,
          ...(output === undefined ? {} : { output }),
        },
      ),
    ];
  }

  private projectResult(native: NativeRecord): CanonicalEvent[] {
    if (native.subtype !== "success") return [];
    if (typeof native.is_error !== "boolean") {
      throw new Error("Cursor result requires is_error");
    }
    const text = this.assistantText.join("");
    const usage = cursorUsage(native.usage);
    return [
      ...(!native.is_error && text
        ? [
            this.event("message_completed", native, {
              text,
              messageAnchor: "assistant-0",
              native,
            }),
          ]
        : []),
      ...(usage ? [this.event("usage_reported", native, { usage })] : []),
      this.event(native.is_error ? "run_failed" : "run_completed", native, {
        result: native.result,
        nativeStatus: native.subtype,
        durationMs: native.duration_ms,
        durationApiMs: native.duration_api_ms,
        native,
      }),
    ];
  }

  private event(
    kind: CanonicalEventKind,
    native: NativeRecord,
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
      nativeEventId: `cursor:${this.context.runId}:${this.anchor(native)}:${sequence}`,
      payload: { runtime: "cursor", ...payload },
    });
  }

  private anchor(native: NativeRecord): string {
    return (
      nonEmptyString(native.call_id) ??
      nonEmptyString(native.session_id) ??
      nonEmptyString(native.subtype) ??
      nonEmptyString(native.type) ??
      "event"
    );
  }
}

function cursorUsage(value: unknown): NativeRecord | undefined {
  const usage = record(value);
  if (!usage) return undefined;
  const input = tokenCount(usage.inputTokens);
  const cacheRead = tokenCount(usage.cacheReadTokens);
  const output = tokenCount(usage.outputTokens);
  if (input === undefined && cacheRead === undefined && output === undefined) {
    return undefined;
  }
  return {
    input_tokens: input ?? 0,
    cache_read_input_tokens: cacheRead ?? 0,
    output_tokens: output ?? 0,
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function record(value: unknown): NativeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeRecord)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isToolCallName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*ToolCall$/u.test(name);
}

function normalizedToolName(nativeName: string): string {
  if (nativeName === "readToolCall") return "Read";
  if (nativeName === "writeToolCall") return "Write";
  if (nativeName === "shellToolCall") return "Bash";
  const base = nativeName.slice(0, -"ToolCall".length);
  return `${base[0]?.toUpperCase() ?? ""}${base.slice(1)}`;
}

function textualOutput(
  value: unknown,
  seen = new WeakSet<object>(),
): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const output = textualOutput(entry, seen);
      if (output !== undefined) return output;
    }
    return undefined;
  }
  const native = value as NativeRecord;
  for (const key of [
    "output",
    "stdout",
    "stderr",
    "message",
    "content",
    "text",
  ]) {
    if (typeof native[key] === "string" && native[key]) return native[key];
  }
  for (const nested of Object.values(native)) {
    const output = textualOutput(nested, seen);
    if (output !== undefined) return output;
  }
  return undefined;
}
