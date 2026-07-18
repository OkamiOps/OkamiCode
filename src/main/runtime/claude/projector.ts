import {
  canonicalEventSchema,
  type CanonicalEvent,
  type CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";

type NativeRecord = Record<string, unknown>;

export interface ClaudeProjectionContext {
  taskId: TaskId;
  laneId: LaneId;
  runId: RunId;
  createEventId: (sequence: number) => string;
  now?: () => string;
  resumed?: boolean;
}

export function claudeSessionIdFromInit(message: unknown): string | undefined {
  const value = record(message);
  return value?.type === "system" && value.subtype === "init"
    ? string(value.session_id)
    : undefined;
}

export class ClaudeProjector {
  private sequence = 0;
  private readonly startedTools = new Set<string>();
  private readonly now: () => string;

  constructor(private readonly context: ClaudeProjectionContext) {
    this.now = context.now ?? (() => new Date().toISOString());
  }

  projectAll(messages: unknown[]): CanonicalEvent[] {
    return messages.flatMap((message) => this.project(message));
  }

  project(message: unknown): CanonicalEvent[] {
    const native = record(message);
    if (!native) return [];
    const type = string(native.type);
    if (type === "system") return this.projectSystem(native);
    if (type === "stream_event") return this.projectStreamEvent(native);
    if (type === "assistant") return this.projectAssistant(native);
    if (type === "user") return this.projectUser(native);
    if (type === "result") return this.projectResult(native);
    if (type === "rate_limit_event") {
      return [this.event("rate_limit_updated", native, { rateLimit: native })];
    }
    return [];
  }

  private projectSystem(native: NativeRecord): CanonicalEvent[] {
    const subtype = string(native.subtype);
    if (subtype === "init") {
      const nativeSessionId = string(native.session_id) ?? "missing-session-id";
      return [
        this.event(
          this.context.resumed ? "session_resumed" : "session_started",
          native,
          {
            nativeSessionId,
            authSource: native.apiKeySource,
            runtimeVersion: native.claude_code_version,
            model: native.model,
          },
        ),
      ];
    }
    if (subtype?.startsWith("hook_")) {
      return [
        this.event("tool_call_updated", native, {
          hookEvent: subtype,
          hookId: native.hook_id,
          hookName: native.hook_name,
          hookOutcome: native.outcome,
          native,
        }),
      ];
    }
    if (subtype === "permission_denied") {
      return [
        this.event("approval_resolved", native, {
          decision: "deny",
          native,
        }),
      ];
    }
    return [];
  }

  private projectStreamEvent(native: NativeRecord): CanonicalEvent[] {
    const event = record(native.event);
    if (!event) return [];
    const eventType = string(event.type);
    if (eventType === "content_block_delta") {
      const delta = record(event.delta);
      if (delta?.type === "text_delta") {
        return [
          this.event("message_delta", native, {
            delta: string(delta.text) ?? "",
            index: event.index,
          }),
        ];
      }
      if (delta?.type === "input_json_delta") {
        return [
          this.event("tool_call_updated", native, {
            toolUseId: native.parent_tool_use_id,
            partialJson: delta.partial_json,
          }),
        ];
      }
    }
    if (eventType === "content_block_start") {
      const block = record(event.content_block);
      if (block?.type === "tool_use") {
        const toolUseId = nativeId(block.id) ?? this.anchor(native);
        this.startedTools.add(toolUseId);
        return [
          this.event("tool_call_started", native, {
            toolUseId,
            toolName: block.name,
            input: block.input,
          }),
        ];
      }
    }
    return [];
  }

  private projectAssistant(native: NativeRecord): CanonicalEvent[] {
    const message = record(native.message);
    const content = array(message?.content);
    const events: CanonicalEvent[] = [];
    for (const entry of content) {
      const block = record(entry);
      if (block?.type === "text") {
        events.push(
          this.event("message_completed", native, {
            messageId: message?.id,
            text: string(block.text) ?? "",
          }),
        );
      }
      if (block?.type === "tool_use") {
        const toolUseId = nativeId(block.id) ?? this.anchor(native);
        if (!this.startedTools.has(toolUseId)) {
          this.startedTools.add(toolUseId);
          events.push(
            this.event("tool_call_started", native, {
              toolUseId,
              toolName: block.name,
              input: block.input,
            }),
          );
        }
      }
    }
    return events;
  }

  private projectUser(native: NativeRecord): CanonicalEvent[] {
    const content = array(record(native.message)?.content);
    return content.flatMap((entry) => {
      const block = record(entry);
      if (block?.type !== "tool_result") return [];
      return [
        this.event("tool_call_completed", native, {
          toolUseId: block.tool_use_id,
          output: block.content,
          isError: block.is_error === true,
        }),
      ];
    });
  }

  private projectResult(native: NativeRecord): CanonicalEvent[] {
    const terminalKind: CanonicalEventKind =
      native.is_error === true || native.subtype === "error"
        ? "run_failed"
        : "run_completed";
    const events: CanonicalEvent[] = [];
    if (record(native.usage)) {
      events.push(
        this.event("usage_reported", native, {
          usage: native.usage,
          modelUsage: native.modelUsage,
          totalCostUsd: native.total_cost_usd,
        }),
      );
    }
    events.push(
      this.event(terminalKind, native, {
        result: native.result,
        nativeStatus: native.subtype,
        durationMs: native.duration_ms,
        numTurns: native.num_turns,
      }),
    );
    return events;
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
      nativeEventId: `claude:${this.anchor(native)}:${sequence}`,
      payload: { runtime: "claude", ...payload },
    });
  }

  private anchor(native: NativeRecord): string {
    return (
      nativeId(native.uuid) ??
      nativeId(native.hook_id) ??
      nativeId(native.session_id) ??
      string(native.type) ??
      "event"
    );
  }
}

function record(value: unknown): NativeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeRecord)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nativeId(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}
