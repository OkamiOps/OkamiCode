import type { Database } from "../db/connection";
import type { ProviderKind, RuntimeKind } from "../../shared/contracts/lane";

export enum UsageSourceKind {
  OfficialStructured = "official_structured",
  NativePresentational = "native_presentational",
  DashboardRead = "dashboard_read",
  LocalEstimate = "local_estimate",
  Unavailable = "unavailable",
}

export type UsageFreshness =
  "live" | "stale" | "partial" | "estimated" | "unavailable";

export interface UsageSource {
  adapterVersion: string;
  kind: UsageSourceKind;
  method: string;
}

export interface UsageWindow {
  durationMinutes: number | null;
  kind: string;
  label: string;
  modelGroup: string | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  usedPercent: number | null;
}

export interface UsageSnapshot {
  accountLabel: string;
  accountRef: string;
  collectedAt: string;
  credits: Record<string, unknown> | null;
  error: string | null;
  freshness: UsageFreshness;
  plan: string | null;
  provider: ProviderKind;
  runtime: RuntimeKind;
  sessionContext?: SessionContext;
  source: UsageSource;
  validUntil: string | null;
  windows: UsageWindow[];
}

export interface SessionContext {
  collectedAt: string;
  freshness: UsageFreshness;
  laneId: string | null;
  remainingTokens: number | null;
  source: UsageSource;
  usedPercent: number | null;
}

export interface UsageActivityBucket {
  bucketStart: string;
  cachedInputTokens: number;
  durationMs: number;
  inputTokens: number;
  laneId: string;
  messages: number;
  model: string;
  modelCalls: number;
  outputTokens: number;
  provider: ProviderKind;
  reasoningTokens: number;
  runtime: RuntimeKind;
  sessions: number;
  taskId: string;
  taskLabel?: string;
  toolCalls: number;
}

export interface UsageAlert {
  accountRef: string;
  enabled: boolean;
  provider: ProviderKind;
  remainingPercent: number;
}

export interface UsageOverview {
  activity: UsageActivityBucket[];
  alerts: UsageAlert[];
  context: SessionContext;
  generatedAt: string;
  subscriptions: UsageSnapshot[];
}

export function withFreshness<T extends UsageSnapshot>(
  snapshot: T,
  options: { collectedAt?: string; now: string; staleAfterMs?: number },
): T {
  if (snapshot.freshness === "unavailable") return snapshot;
  const collectedAt = options.collectedAt ?? snapshot.collectedAt;
  const validUntil = snapshot.validUntil
    ? Date.parse(snapshot.validUntil)
    : Date.parse(collectedAt) + (options.staleAfterMs ?? 15 * 60 * 1000);
  if (Date.parse(options.now) <= validUntil) return snapshot;
  return {
    ...snapshot,
    freshness: "stale",
    sessionContext: snapshot.sessionContext
      ? { ...snapshot.sessionContext, freshness: "stale" }
      : undefined,
  };
}

interface SnapshotRow {
  account_ref: string;
  adapter_version: string;
  collected_at: string;
  credits_json: string | null;
  duration_minutes: number | null;
  freshness: UsageFreshness;
  model_group: string | null;
  native_payload_json: string | null;
  provider_kind: UsageSnapshot["provider"];
  remaining_percent: number | null;
  resets_at: string | null;
  source_kind: UsageSourceKind;
  used_percent: number | null;
  valid_until: string | null;
  window_kind: string;
}

export class UsageSnapshotRepository {
  constructor(
    private readonly db: Database,
    private readonly createId: () => string,
  ) {}

  save(snapshot: UsageSnapshot): void {
    this.db.transaction(() => this.saveTransaction(snapshot))();
  }

  readLatest(): UsageSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT us.provider_kind, us.account_ref, us.source_kind, us.adapter_version,
                uw.window_kind, uw.model_group, uw.duration_minutes,
                sn.used_percent, sn.remaining_percent, sn.resets_at, sn.credits_json,
                sn.freshness, sn.native_payload_json, sn.collected_at, sn.valid_until
         FROM usage_sources us
         JOIN usage_windows uw ON uw.source_id = us.id
         JOIN usage_snapshots sn ON sn.window_id = uw.id
         WHERE sn.collected_at = (
           SELECT MAX(latest.collected_at)
           FROM usage_snapshots latest
           JOIN usage_windows latest_window ON latest_window.id = latest.window_id
           JOIN usage_sources latest_source ON latest_source.id = latest_window.source_id
           WHERE latest_source.provider_kind = us.provider_kind
             AND latest_source.account_ref = us.account_ref
         )
         ORDER BY us.provider_kind, us.account_ref, uw.duration_minutes`,
      )
      .all() as SnapshotRow[];
    return groupSnapshotRows(rows);
  }

  private saveTransaction(snapshot: UsageSnapshot): void {
    let sourceId = (
      this.db
        .prepare(
          `SELECT id FROM usage_sources
           WHERE provider_kind = ? AND account_ref = ? AND source_kind = ?`,
        )
        .get(snapshot.provider, snapshot.accountRef, snapshot.source.kind) as
        { id: string } | undefined
    )?.id;
    if (!sourceId) {
      sourceId = this.createId();
      this.db
        .prepare(
          `INSERT INTO usage_sources
           (id, provider_kind, account_ref, source_kind, adapter_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceId,
          snapshot.provider,
          snapshot.accountRef,
          snapshot.source.kind,
          snapshot.source.adapterVersion,
          snapshot.collectedAt,
        );
    }
    const windows = snapshot.windows.length
      ? snapshot.windows
      : [emptyWindow(snapshot.freshness)];
    for (const window of windows) this.saveWindow(sourceId, snapshot, window);
  }

  private saveWindow(
    sourceId: string,
    snapshot: UsageSnapshot,
    window: UsageWindow,
  ): void {
    let windowId = (
      this.db
        .prepare(
          `SELECT id FROM usage_windows
           WHERE source_id = ? AND window_kind = ? AND model_group IS ?`,
        )
        .get(sourceId, window.kind, window.modelGroup) as
        { id: string } | undefined
    )?.id;
    if (!windowId) {
      windowId = this.createId();
      this.db
        .prepare(
          `INSERT INTO usage_windows
           (id, source_id, window_kind, model_group, duration_minutes)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          windowId,
          sourceId,
          window.kind,
          window.modelGroup,
          window.durationMinutes,
        );
    }
    this.db
      .prepare(
        `DELETE FROM usage_snapshots
         WHERE window_id = ? AND collected_at = ?`,
      )
      .run(windowId, snapshot.collectedAt);
    this.db
      .prepare(
        `INSERT INTO usage_snapshots
         (id, window_id, used_percent, remaining_percent, resets_at, credits_json,
          freshness, reliability, native_payload_json, collected_at, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.createId(),
        windowId,
        window.usedPercent,
        window.remainingPercent,
        window.resetsAt,
        snapshot.credits ? JSON.stringify(snapshot.credits) : null,
        snapshot.freshness,
        reliability(snapshot.source.kind),
        JSON.stringify(snapshotMetadata(snapshot, window.label)),
        snapshot.collectedAt,
        snapshot.validUntil,
      );
  }
}

function groupSnapshotRows(rows: SnapshotRow[]): UsageSnapshot[] {
  const grouped = new Map<string, UsageSnapshot>();
  for (const row of rows) {
    const metadata = parseMetadata(row.native_payload_json);
    const key = `${row.provider_kind}:${row.account_ref}`;
    const current = grouped.get(key) ?? snapshotFromRow(row, metadata);
    if (row.window_kind !== "unavailable") {
      current.windows.push({
        durationMinutes: row.duration_minutes,
        kind: row.window_kind,
        label: metadata.windowLabel ?? row.window_kind,
        modelGroup: row.model_group,
        remainingPercent: row.remaining_percent,
        resetsAt: row.resets_at,
        usedPercent: row.used_percent,
      });
    }
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function snapshotFromRow(
  row: SnapshotRow,
  metadata: ReturnType<typeof parseMetadata>,
): UsageSnapshot {
  return {
    accountLabel: metadata.accountLabel ?? row.account_ref,
    accountRef: row.account_ref,
    collectedAt: row.collected_at,
    credits: parseRecord(row.credits_json),
    error: metadata.error ?? null,
    freshness: row.freshness,
    plan: metadata.plan ?? null,
    provider: row.provider_kind,
    runtime: metadata.runtime ?? "codex",
    sessionContext: metadata.sessionContext,
    source: {
      adapterVersion: row.adapter_version,
      kind: row.source_kind,
      method: metadata.sourceMethod ?? "unavailable",
    },
    validUntil: row.valid_until,
    windows: [],
  };
}

function snapshotMetadata(snapshot: UsageSnapshot, windowLabel: string) {
  return {
    accountLabel: snapshot.accountLabel,
    error: snapshot.error,
    plan: snapshot.plan,
    runtime: snapshot.runtime,
    sessionContext: snapshot.sessionContext,
    sourceMethod: snapshot.source.method,
    windowLabel,
  };
}

function parseMetadata(value: string | null): {
  accountLabel?: string;
  error?: string | null;
  plan?: string | null;
  runtime?: UsageSnapshot["runtime"];
  sessionContext?: SessionContext;
  sourceMethod?: string;
  windowLabel?: string;
} {
  return (parseRecord(value) ?? {}) as ReturnType<typeof parseMetadata>;
}

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function emptyWindow(freshness: UsageFreshness): UsageWindow {
  return {
    durationMinutes: null,
    kind: "unavailable",
    label: freshness,
    modelGroup: null,
    remainingPercent: null,
    resetsAt: null,
    usedPercent: null,
  };
}

function reliability(kind: UsageSourceKind): string {
  return kind === UsageSourceKind.OfficialStructured
    ? "high"
    : kind === UsageSourceKind.Unavailable
      ? "none"
      : "medium";
}
