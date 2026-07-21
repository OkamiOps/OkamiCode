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
      events.push(
        this.event("message_delta", native, {
          delta: text,
          messageAnchor: "assistant-0",
          native,
        }),
      );
    }
    return events;
  }

  completed(success: boolean): CanonicalEvent {
    return this.event(
      success ? "run_completed" : "run_failed",
      {},
      {
        ...(success ? {} : { reason: "mimo_process_failed" }),
      },
    );
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
