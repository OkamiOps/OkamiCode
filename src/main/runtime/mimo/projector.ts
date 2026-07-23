import {
  canonicalEventSchema,
  type CanonicalEvent,
  type CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";

type NativeRecord = Record<string, unknown>;

export class MimoProjector {
  private sequence = 0;
  private sessionId: string | undefined;
  private emittedSession = false;
  private readonly assistantText: string[] = [];

  constructor(
    private readonly context: {
      taskId: TaskId;
      laneId: LaneId;
      runId: RunId;
      createEventId: (sequence: number) => string;
      now?: () => string;
      nativeSessionId?: string;
    },
  ) {
    this.sessionId = context.nativeSessionId;
  }

  get nativeSessionId(): string | undefined {
    return this.sessionId;
  }

  project(value: unknown): CanonicalEvent[] {
    const native = record(value);
    if (!native) return [];
    const nextSessionId = nonEmptyString(native.sessionID ?? native.sessionId);
    if (nextSessionId) {
      if (this.sessionId && this.sessionId !== nextSessionId) {
        throw new Error("MiMo session changed during the run");
      }
      this.sessionId = nextSessionId;
    }

    const events: CanonicalEvent[] = [];
    if (!this.emittedSession && this.sessionId) {
      this.emittedSession = true;
      events.push(
        this.event(
          this.context.nativeSessionId ? "session_resumed" : "session_started",
          native,
          { nativeSessionId: this.sessionId, native },
        ),
      );
    }
    const text = textDelta(native);
    if (text !== undefined) {
      this.assistantText.push(text);
      events.push(
        this.event("message_delta", native, {
          delta: text,
          messageAnchor: "assistant-0",
          native,
        }),
      );
    }
    const usage = mimoUsage(native);
    if (usage) {
      events.push(this.event("usage_reported", native, { usage }));
    }
    return events;
  }

  completed(success: boolean): CanonicalEvent[] {
    const text = this.assistantText.join("");
    return [
      ...(success && text
        ? [
            this.event(
              "message_completed",
              {},
              {
                text,
                messageAnchor: "assistant-0",
              },
            ),
          ]
        : []),
      this.event(
        success ? "run_completed" : "run_failed",
        {},
        {
          ...(success ? {} : { reason: "mimo_process_failed" }),
        },
      ),
    ];
  }

  failed(reason: string): CanonicalEvent {
    return this.event("run_failed", {}, { reason });
  }

  cancelled(): CanonicalEvent {
    return this.event("run_cancelled", {}, { reason: "user_cancelled" });
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
      occurredAt: this.context.now?.() ?? new Date().toISOString(),
      kind,
      nativeEventId: `mimo:${this.context.runId}:${sequence}`,
      payload: { runtime: "mimo", ...payload },
    });
  }
}

function mimoUsage(native: NativeRecord): NativeRecord | undefined {
  const part = record(native.part);
  const tokens = record(part?.tokens ?? native.tokens);
  if (!tokens) return undefined;
  const cache = record(tokens.cache);
  const input = tokenCount(tokens.input);
  const cacheRead = tokenCount(cache?.read);
  const output = tokenCount(tokens.output);
  if (input === undefined && cacheRead === undefined && output === undefined) {
    return undefined;
  }
  return {
    input_tokens: input ?? 0,
    cache_read_input_tokens: cacheRead ?? 0,
    output_tokens: output ?? 0,
    ...(tokenCount(tokens.reasoning) === undefined
      ? {}
      : { reasoning_tokens: tokenCount(tokens.reasoning) }),
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function textDelta(native: NativeRecord): string | undefined {
  const part = record(native.part);
  if (native.type !== "text" && part?.type !== "text") return undefined;
  return nonEmptyString(part?.text ?? native.text ?? native.data);
}

function record(value: unknown): NativeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeRecord)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
