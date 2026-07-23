import {
  canonicalEventSchema,
  type CanonicalEvent,
  type CanonicalEventKind,
} from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { canonicalTurnUsage, tokenCount } from "../usage";

type NativeRecord = Record<string, unknown>;

export interface CodexProjectionContext {
  taskId: TaskId;
  laneId: LaneId;
  runId: RunId;
  createEventId: (sequence: number) => string;
  now?: () => string;
}

const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "contextCompaction",
  "dynamicToolCall",
  "enteredReviewMode",
  "exitedReviewMode",
  "fileChange",
  "imageGeneration",
  "imageView",
  "mcpToolCall",
  "sleep",
  "webSearch",
]);

const SUBAGENT_ITEM_TYPES = new Set([
  "collabAgentToolCall",
  "subAgentActivity",
]);

export class CodexProjector {
  private sequence = 0;
  private readonly now: () => string;

  constructor(private readonly context: CodexProjectionContext) {
    this.now = context.now ?? (() => new Date().toISOString());
  }

  projectAll(messages: unknown[]): CanonicalEvent[] {
    return messages.flatMap((message) => this.project(message));
  }

  project(message: unknown): CanonicalEvent[] {
    const envelope = record(message);
    const method = string(envelope?.method);
    if (!envelope || !method) return [];

    const params = record(envelope.params) ?? {};
    if (isApprovalRequest(envelope, method)) {
      const requestId = nativeScalar(envelope.id) ?? "missing-request-id";
      const approvalId = nativeScalar(params.approvalId) ?? requestId;
      return [
        this.event("approval_requested", method, approvalId, params, {
          approvalId,
          requestId,
          nativeMethod: method,
          native: params,
        }),
      ];
    }

    if (method === "serverRequest/resolved") {
      const requestId = nativeScalar(params.requestId) ?? "missing-request-id";
      return [
        this.event("approval_resolved", method, requestId, params, {
          approvalId: requestId,
          requestId,
          nativeMethod: method,
          native: params,
        }),
      ];
    }

    if (method === "thread/started" || method === "thread/resumed") {
      const thread = record(params.thread) ?? params;
      const threadId = nativeScalar(thread.id ?? params.threadId) ?? "thread";
      return [
        this.event(
          method === "thread/started" ? "session_started" : "session_resumed",
          method,
          threadId,
          params,
          { nativeSessionId: threadId, nativeMethod: method, thread },
        ),
      ];
    }

    if (method === "thread/tokenUsage/updated") {
      const tokenUsage = record(params.tokenUsage);
      const last = record(tokenUsage?.last);
      const usage = last
        ? canonicalTurnUsage({
            aggregation: "snapshot",
            scope: "turn",
            inputTokenSemantics: "includes_cache_read",
            reasoningTokenSemantics: "includes_output",
            inputTokens: tokenCount(last.inputTokens),
            cacheReadInputTokens: tokenCount(last.cachedInputTokens),
            cacheCreationInputTokens: tokenCount(last.cacheWriteInputTokens),
            outputTokens: tokenCount(last.outputTokens),
            reasoningTokens: tokenCount(last.reasoningOutputTokens),
            reportedTotalTokens: tokenCount(last.totalTokens),
          })
        : undefined;
      return [
        this.event("usage_reported", method, anchor(params), params, {
          nativeMethod: method,
          usage: usage ?? {
            available: false,
            source: "codex_app_server",
          },
        }),
      ];
    }

    if (method === "account/rateLimits/updated") {
      return [
        this.event("rate_limit_updated", method, anchor(params), params, {
          nativeMethod: method,
          rateLimits: params.rateLimits ?? params,
        }),
      ];
    }

    if (method === "turn/completed") {
      const turn = record(params.turn) ?? {};
      const status = string(turn.status) ?? "unknown";
      return [
        this.event(
          status === "failed" ? "run_failed" : "run_completed",
          method,
          nativeScalar(turn.id) ?? anchor(params),
          params,
          { nativeMethod: method, nativeStatus: status, turn },
        ),
      ];
    }

    if (method === "turn/diff/updated" || method === "turn/plan/updated") {
      return [
        this.event("tool_call_updated", method, anchor(params), params, {
          nativeMethod: method,
          native: params,
        }),
      ];
    }

    if (method === "item/agentMessage/delta") {
      return [
        this.event("message_delta", method, anchor(params), params, {
          delta: string(params.delta) ?? "",
          itemId: nativeScalar(params.itemId),
          nativeMethod: method,
        }),
      ];
    }

    if (method.startsWith("item/")) return this.projectItem(method, params);
    return [];
  }

  private projectItem(method: string, params: NativeRecord): CanonicalEvent[] {
    const item = record(params.item);
    const itemType = string(item?.type);
    const itemId = nativeScalar(item?.id ?? params.itemId) ?? "item";

    if (itemType === "agentMessage") {
      return method === "item/completed"
        ? [
            this.event("message_completed", method, itemId, params, {
              itemId,
              nativeMethod: method,
              text: string(item?.text) ?? "",
            }),
          ]
        : [];
    }

    if (itemType && SUBAGENT_ITEM_TYPES.has(itemType)) {
      const completed = method === "item/completed";
      return [
        this.event(
          completed ? "subagent_completed" : "subagent_started",
          method,
          itemId,
          params,
          { item, itemId, nativeItemType: itemType, nativeMethod: method },
        ),
      ];
    }

    if (itemType && TOOL_ITEM_TYPES.has(itemType)) {
      const kind = toolEventKind(method);
      return [
        this.event(kind, method, itemId, params, {
          item: item ?? params,
          itemId,
          nativeItemType: itemType,
          nativeMethod: method,
        }),
      ];
    }

    if (!itemType && method !== "item/started" && method !== "item/completed") {
      return [
        this.event("tool_call_updated", method, itemId, params, {
          itemId,
          nativeMethod: method,
          native: params,
        }),
      ];
    }

    if (
      itemType === "userMessage" ||
      itemType === "reasoning" ||
      itemType === "plan"
    ) {
      return [];
    }

    return [
      this.event("tool_call_updated", method, itemId, params, {
        adapterStatus: "unknown_native_event",
        item: item ?? params,
        itemId,
        nativeItemType: itemType ?? "unknown",
        nativeMethod: method,
      }),
    ];
  }

  private event(
    kind: CanonicalEventKind,
    method: string,
    nativeAnchor: string,
    params: NativeRecord,
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
      occurredAt: occurredAt(params, this.now),
      kind,
      // Same collision guard as the Claude projector: sequence restarts per
      // turn, so the runId keeps ids unique across turns of one thread.
      nativeEventId: `${this.context.runId}:${method}:${nativeAnchor}:${sequence}`,
      payload: { runtime: "codex", ...payload },
    });
  }
}

function toolEventKind(method: string): CanonicalEventKind {
  if (method === "item/started") return "tool_call_started";
  if (method === "item/completed") return "tool_call_completed";
  return "tool_call_updated";
}

function isApprovalRequest(envelope: NativeRecord, method: string): boolean {
  return (
    (typeof envelope.id === "string" || typeof envelope.id === "number") &&
    (method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval" ||
      method === "item/permissions/requestApproval")
  );
}

function occurredAt(params: NativeRecord, fallback: () => string): string {
  if (typeof params.startedAtMs === "number") {
    return new Date(params.startedAtMs).toISOString();
  }
  const turn = record(params.turn);
  const seconds =
    typeof turn?.completedAt === "number"
      ? turn.completedAt
      : typeof turn?.startedAt === "number"
        ? turn.startedAt
        : undefined;
  return seconds === undefined
    ? fallback()
    : new Date(seconds * 1000).toISOString();
}

function anchor(params: NativeRecord): string {
  return (
    nativeScalar(params.itemId) ??
    nativeScalar(params.turnId) ??
    nativeScalar(params.threadId) ??
    "notification"
  );
}

function record(value: unknown): NativeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeRecord)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nativeScalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}
