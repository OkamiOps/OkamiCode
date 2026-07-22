import {
  canonicalEventSchema,
  type CanonicalEvent,
  type CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";

type NativeRecord = Record<string, unknown>;

export class GrokProjector {
  private sequence = 0;
  private readonly assistantText: string[] = [];
  constructor(
    private readonly context: {
      taskId: TaskId;
      laneId: LaneId;
      runId: RunId;
      nativeSessionId: string;
      createEventId: (sequence: number) => string;
      now?: () => string;
    },
  ) {}

  sessionEvent(): CanonicalEvent {
    return this.event(
      "session_resumed",
      { type: "session" },
      {
        nativeSessionId: this.context.nativeSessionId,
      },
    );
  }

  project(value: unknown): CanonicalEvent[] {
    const native = record(value);
    if (!native || typeof native.type !== "string") return [];
    if (native.type === "text" && typeof native.data === "string") {
      this.assistantText.push(native.data);
      return [
        this.event("message_delta", native, {
          delta: native.data,
          messageAnchor: "assistant-0",
          native,
        }),
      ];
    }
    if (native.type === "end") {
      const sessionId = stringValue(native.sessionId);
      if (sessionId && sessionId !== this.context.nativeSessionId) {
        throw new Error("Grok end event returned a different session id");
      }
      const text = this.assistantText.join("");
      return [
        ...(text
          ? [
              this.event("message_completed", native, {
                text,
                messageAnchor: "assistant-0",
                native,
              }),
            ]
          : []),
        this.event("run_completed", native, { native }),
      ];
    }
    if (native.type === "error") {
      return [
        this.event("run_failed", native, {
          reason: stringValue(native.message) ?? "grok_runtime_error",
          native,
        }),
      ];
    }
    return [];
  }

  cancelled(native: NativeRecord): CanonicalEvent {
    return this.event("run_cancelled", native, {
      reason: "user_cancelled",
      native,
    });
  }

  failed(native: NativeRecord): CanonicalEvent {
    return this.event("run_failed", native, {
      reason: "grok_process_ended_without_terminal_event",
      native,
    });
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
      nativeEventId: `grok:${this.context.runId}:${String(native.type ?? "event")}:${sequence}`,
      payload: { runtime: "grok", ...payload },
    });
  }
}

function record(value: unknown): NativeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeRecord)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
