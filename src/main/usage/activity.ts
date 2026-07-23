import type { Database } from "../db/connection";
import {
  UsageSourceKind,
  type SessionContext,
  type UsageActivityBucket,
} from "./model";

interface UsageEventRow {
  lane_id: string;
  model: string;
  occurred_at: string;
  payload_json: string;
}

interface ActivityRow extends UsageEventRow {
  bucket_start: string;
  bucket_minutes: number;
  cached_input_tokens: number;
  duration_ms?: number;
  input_tokens: number;
  kind?: string;
  messages?: number;
  model_calls: number;
  output_tokens: number;
  provider_kind: UsageActivityBucket["provider"];
  reasoning_tokens: number;
  runtime_kind: UsageActivityBucket["runtime"];
  sessions?: number;
  task_id: string;
  task_title: string;
  tool_calls?: number;
}

export class UsageActivityService {
  constructor(private readonly db: Database) {}

  rebuild(): void {
    const events = this.db
      .prepare(
        `SELECT e.lane_id, e.occurred_at, e.payload_json,
                COALESCE(
                  (SELECT json_extract(session.payload_json, '$.model')
                   FROM events session
                   WHERE session.run_id = e.run_id
                     AND session.kind IN ('session_started', 'session_resumed')
                   ORDER BY session.sequence
                   LIMIT 1),
                  l.model
                ) AS model
         FROM events e JOIN runtime_lanes l ON l.id = e.lane_id
         WHERE e.kind = 'usage_reported'
         ORDER BY e.occurred_at, e.sequence`,
      )
      .all() as UsageEventRow[];
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM usage_activity_buckets").run();
      const insert = this.db.prepare(
        `INSERT INTO usage_activity_buckets
         (id, lane_id, bucket_start, bucket_minutes, model, input_tokens,
          cached_input_tokens, output_tokens, reasoning_tokens, model_calls)
         VALUES (?, ?, ?, 60, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(lane_id, bucket_start, bucket_minutes, model) DO UPDATE SET
           input_tokens = input_tokens + excluded.input_tokens,
           cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
           model_calls = model_calls + 1`,
      );
      for (const event of events) {
        const payload = parse(event.payload_json);
        const bucketStart = hourStart(event.occurred_at);
        const sample = usageSample(payload, event.model);
        const usage = record(sample.usage);
        if (
          !usage ||
          typeof usage.observed_total_tokens !== "number" ||
          !Number.isFinite(usage.observed_total_tokens)
        ) {
          continue;
        }
        const cacheRead = numeric(usage, [
          "cache_read_input_tokens",
          "cacheReadInputTokens",
          "cachedInputTokens",
        ]);
        const cacheCreation = numeric(usage, [
          "cache_creation_input_tokens",
          "cacheCreationInputTokens",
        ]);
        const rawInput = numeric(usage, ["input_tokens", "inputTokens"]);
        const inputTokens =
          usage.input_token_semantics === "includes_cache_read"
            ? Math.max(0, rawInput - cacheRead - cacheCreation)
            : rawInput;
        const reasoningTokens =
          usage.reasoning_token_semantics === "includes_output"
            ? 0
            : numeric(usage, ["reasoning_tokens", "reasoningTokens"]);
        insert.run(
          `${event.lane_id}:${bucketStart}:${sample.model}`,
          event.lane_id,
          bucketStart,
          sample.model,
          inputTokens,
          cacheRead + cacheCreation,
          numeric(usage, ["output_tokens", "outputTokens"]),
          reasoningTokens,
        );
      }
    })();
  }

  readBuckets(): UsageActivityBucket[] {
    const rows = this.db
      .prepare(
        `SELECT b.*, l.task_id, l.runtime_kind, l.provider_kind,
                t.title AS task_title, '{}' AS payload_json, b.bucket_start AS occurred_at
         FROM usage_activity_buckets b
         JOIN runtime_lanes l ON l.id = b.lane_id
         JOIN tasks t ON t.id = l.task_id
         ORDER BY b.bucket_start`,
      )
      .all() as ActivityRow[];
    const activity = new Map(
      rows.map((row) => [
        activityKey(row.lane_id, row.bucket_start, row.model),
        project(row),
      ]),
    );
    const events = this.db
      .prepare(
        `SELECT e.lane_id, e.occurred_at, e.kind, e.payload_json,
                l.model, l.task_id, l.runtime_kind, l.provider_kind,
                t.title AS task_title, 60 AS bucket_minutes,
                0 AS input_tokens, 0 AS cached_input_tokens, 0 AS output_tokens,
                0 AS reasoning_tokens, 0 AS model_calls
         FROM events e
         JOIN runtime_lanes l ON l.id = e.lane_id
         JOIN tasks t ON t.id = l.task_id
         WHERE e.kind IN ('session_started','session_resumed','message_completed',
                          'tool_call_completed','run_completed')
         ORDER BY e.occurred_at, e.sequence`,
      )
      .all() as ActivityRow[];
    for (const event of events) mergeEvent(activity, event);
    return [...activity.values()].sort((left, right) =>
      left.bucketStart.localeCompare(right.bucketStart),
    );
  }

  readSessionContext(): SessionContext {
    const row = this.db
      .prepare(
        `SELECT lane_id, occurred_at, payload_json
         FROM events
         WHERE kind = 'usage_reported'
           AND json_type(payload_json, '$.usage.observed_total_tokens')
               IN ('integer', 'real')
         ORDER BY occurred_at DESC, sequence DESC LIMIT 1`,
      )
      .get() as
      | { lane_id: string; occurred_at: string; payload_json: string }
      | undefined;
    if (!row) return unavailableContext(new Date().toISOString());
    const payload = parse(row.payload_json);
    const contextWindow = numeric(payload, [
      "context_window",
      "contextWindow",
      "model_context_window",
    ]);
    const usedTokens = numeric(payload, ["observed_total_tokens"]);
    if (contextWindow <= 0)
      return unavailableContext(row.occurred_at, row.lane_id);
    return {
      collectedAt: row.occurred_at,
      freshness: "estimated",
      laneId: row.lane_id,
      remainingTokens: Math.max(0, contextWindow - usedTokens),
      source: {
        adapterVersion: "event-v1",
        kind: UsageSourceKind.LocalEstimate,
        method: "native session usage events",
      },
      usedPercent: Math.min(100, (usedTokens / contextWindow) * 100),
    };
  }
}

function project(row: ActivityRow): UsageActivityBucket {
  return {
    bucketStart: row.bucket_start,
    cachedInputTokens: row.cached_input_tokens,
    durationMs: row.duration_ms ?? 0,
    inputTokens: row.input_tokens,
    laneId: row.lane_id,
    messages: row.messages ?? 0,
    model: row.model,
    modelCalls: row.model_calls,
    outputTokens: row.output_tokens,
    provider: row.provider_kind,
    reasoningTokens: row.reasoning_tokens,
    runtime: row.runtime_kind,
    sessions: row.sessions ?? 0,
    taskId: row.task_id,
    taskLabel: row.task_title,
    toolCalls: row.tool_calls ?? 0,
  };
}

function mergeEvent(
  activity: Map<string, UsageActivityBucket>,
  row: ActivityRow,
): void {
  const bucketStart = hourStart(row.occurred_at);
  const key = activityKey(row.lane_id, bucketStart, row.model);
  const current =
    activity.get(key) ?? project({ ...row, bucket_start: bucketStart });
  if (row.kind === "session_started" || row.kind === "session_resumed")
    current.sessions++;
  if (row.kind === "message_completed") {
    current.messages++;
    // AGY exposes quota windows but not native per-turn token counters. Keep
    // completed work visible in ROI with a conservative local text estimate;
    // the UI labels this source as estimated instead of presenting fake exact
    // telemetry. Other runtimes continue to use their native usage events.
    if (row.runtime_kind === "agy" && current.outputTokens === 0) {
      current.outputTokens += estimatedTextTokens(parse(row.payload_json));
      current.modelCalls++;
    }
  }
  if (row.kind === "tool_call_completed") current.toolCalls++;
  if (row.kind === "run_completed") {
    current.durationMs += numeric(parse(row.payload_json), [
      "durationMs",
      "duration_ms",
    ]);
  }
  activity.set(key, current);
}

function unavailableContext(
  collectedAt: string,
  laneId: string | null = null,
): SessionContext {
  return {
    collectedAt,
    freshness: "unavailable",
    laneId,
    remainingTokens: null,
    source: {
      adapterVersion: "event-v1",
      kind: UsageSourceKind.Unavailable,
      method: "native session usage events",
    },
    usedPercent: null,
  };
}

function numeric(value: unknown, keys: string[]): number {
  const found = find(value, new Set(keys));
  return typeof found === "number" && Number.isFinite(found)
    ? Math.max(0, found)
    : 0;
}

function estimatedTextTokens(payload: unknown): number {
  const text = find(payload, new Set(["text", "content", "message"]));
  if (typeof text !== "string" || text.trim().length === 0) return 0;
  // UTF-8 bytes / 4 is intentionally conservative and deterministic. It is
  // not called an exact provider reading anywhere in the product.
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

function usageSample(
  payload: unknown,
  fallbackModel: string,
): { model: string; usage: unknown } {
  const root = record(payload);
  const modelUsage = record(root?.modelUsage ?? root?.model_usage);
  const nativeModels = modelUsage ? Object.keys(modelUsage) : [];
  return {
    model:
      (typeof root?.model === "string" ? root.model : null) ??
      (nativeModels.length === 1 ? nativeModels[0] : null) ??
      fallbackModel,
    usage: root?.usage ?? payload,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function find(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = find(entry, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key)) return entry;
    const found = find(entry, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parse(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function hourStart(value: string): string {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function activityKey(
  laneId: string,
  bucketStart: string,
  model: string,
): string {
  return `${laneId}:${bucketStart}:${model}`;
}
