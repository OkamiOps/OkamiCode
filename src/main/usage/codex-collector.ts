import { JsonlProcess } from "../runtime/transport";
import { subscriptionEnvironment } from "../runtime/codex/adapter";
import { CodexClient } from "../runtime/codex/client";
import {
  UsageSourceKind,
  withFreshness,
  type UsageSnapshot,
  type UsageWindow,
} from "./model";

export interface CodexUsageClient {
  readRateLimits(): Promise<Record<string, unknown>>;
  readUsage(): Promise<Record<string, unknown>>;
}

interface CollectCodexOptions {
  accountRef: string;
  collectedAt: string;
}

export async function collectCodexUsage(
  client: CodexUsageClient,
  options: CollectCodexOptions,
): Promise<UsageSnapshot> {
  const [rateLimits, usage] = await Promise.all([
    client.readRateLimits(),
    client.readUsage(),
  ]);
  const windows = findRateLimitWindows(rateLimits);
  if (windows.length === 0) {
    throw new Error("Codex returned no structured rate-limit windows");
  }
  return {
    accountLabel: "ChatGPT",
    accountRef: options.accountRef,
    collectedAt: options.collectedAt,
    credits: record(usage.credits),
    error: null,
    freshness: "live",
    plan: title(
      string(usage.planType) ??
        string(usage.plan_type) ??
        string(record(record(rateLimits)?.rateLimits)?.planType),
    ),
    provider: "chatgpt",
    runtime: "codex",
    source: {
      adapterVersion: "codex-app-server-v1",
      kind: UsageSourceKind.OfficialStructured,
      method: "account/rateLimits/read + account/usage/read",
    },
    validUntil: new Date(
      Date.parse(options.collectedAt) + 10 * 60_000,
    ).toISOString(),
    windows,
  };
}

export class CodexUsageCollector {
  private readonly clock: () => Date;
  private readonly readSnapshot: (
    options: CollectCodexOptions,
  ) => Promise<UsageSnapshot>;
  private readonly ttlMs: number;

  constructor(
    options: {
      clock?: () => Date;
      command?: string;
      env?: NodeJS.ProcessEnv;
      readSnapshot?: (options: CollectCodexOptions) => Promise<UsageSnapshot>;
      ttlMs?: number;
    } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.readSnapshot =
      options.readSnapshot ??
      ((collectOptions) =>
        collectCodexFromCli(collectOptions, {
          command: options.command,
          env: options.env,
        }));
  }

  async collect(options: {
    previous?: UsageSnapshot;
    reason: "overview" | "refresh";
  }): Promise<UsageSnapshot> {
    const now = this.clock();
    if (
      options.reason === "overview" &&
      options.previous &&
      options.previous.freshness === "live" &&
      now.getTime() - Date.parse(options.previous.collectedAt) <= this.ttlMs
    ) {
      return options.previous;
    }
    try {
      return await this.readSnapshot({
        accountRef: options.previous?.accountRef ?? "chatgpt-main",
        collectedAt: now.toISOString(),
      });
    } catch (error) {
      if (options.previous) {
        return {
          ...withFreshness(options.previous, {
            now: now.toISOString(),
            staleAfterMs: 0,
          }),
          error: message(error),
          freshness: "stale",
        };
      }
      return unavailableCodex(now.toISOString(), message(error));
    }
  }
}

async function collectCodexFromCli(
  options: CollectCodexOptions,
  launch: { command?: string; env?: NodeJS.ProcessEnv },
): Promise<UsageSnapshot> {
  const process = await JsonlProcess.spawn(
    launch.command ?? "codex",
    ["app-server", "--stdio"],
    { env: subscriptionEnvironment(launch.env) },
  );
  const client = new CodexClient(process);
  try {
    await client.initialize();
    return await collectCodexUsage(client, options);
  } finally {
    await client.close();
  }
}

// The app-server answers with a documented shape: a primary/secondary window
// for the account limit plus per-model limits under rateLimitsByLimitId. The
// old generic tree walk picked whichever window it met first, which is how a
// per-model 0% ended up presented as the account's weekly usage.
interface CodexWindowPayload {
  usedPercent?: unknown;
  used_percent?: unknown;
  windowDurationMins?: unknown;
  window_duration_mins?: unknown;
  resetsAt?: unknown;
  resets_at?: unknown;
}

function windowFrom(
  payload: unknown,
  modelGroup: string | null,
): UsageWindow | null {
  const candidate = record(payload) as CodexWindowPayload | undefined;
  if (!candidate) return null;
  const usedPercent = number(candidate.usedPercent ?? candidate.used_percent);
  if (usedPercent === null) return null;
  const duration = number(
    candidate.windowDurationMins ?? candidate.window_duration_mins,
  );
  const weekly = duration !== null && duration >= 10_080;
  const base = weekly
    ? "Semanal"
    : duration && duration <= 360
      ? "Sessão"
      : "Janela";
  return {
    durationMinutes: duration,
    kind: weekly ? "weekly" : "five_hour",
    label: modelGroup ? `${base} · ${modelGroup}` : base,
    modelGroup,
    remainingPercent: clamp(100 - usedPercent),
    resetsAt: timestamp(candidate.resetsAt ?? candidate.resets_at),
    usedPercent: clamp(usedPercent),
  };
}

export function findRateLimitWindows(value: unknown): UsageWindow[] {
  const root = record(value);
  const limits = record(root?.rateLimits) ?? root;
  const windows: UsageWindow[] = [];
  for (const key of ["primary", "secondary"]) {
    const window = windowFrom(limits?.[key], null);
    if (window) windows.push(window);
  }
  // Per-model limits only make sense when the API names them.
  const byLimitId = record(root?.rateLimitsByLimitId);
  for (const entry of Object.values(byLimitId ?? {})) {
    const limit = record(entry);
    const name = string(limit?.limitName);
    if (!name) continue;
    const window = windowFrom(limit?.primary, name);
    if (window) windows.push(window);
  }
  return windows;
}

function unavailableCodex(collectedAt: string, error: string): UsageSnapshot {
  return {
    accountLabel: "ChatGPT",
    accountRef: "chatgpt-main",
    collectedAt,
    credits: null,
    error,
    freshness: "unavailable",
    plan: null,
    provider: "chatgpt",
    runtime: "codex",
    source: {
      adapterVersion: "codex-app-server-v1",
      kind: UsageSourceKind.Unavailable,
      method: "account/rateLimits/read + account/usage/read",
    },
    validUntil: null,
    windows: [],
  };
}

function timestamp(value: unknown): string | null {
  if (typeof value === "number") {
    return new Date(
      value < 10_000_000_000 ? value * 1000 : value,
    ).toISOString();
  }
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function title(value: string | null): string | null {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
