import type { IpcRequest } from "../../shared/contracts/ipc";
import type { AppState } from "../ipc/app-state";
import { UsageActivityService } from "./activity";
import { ClaudeUsageCollector } from "./claude-collector";
import { CodexUsageCollector } from "./codex-collector";
import {
  UsageSourceKind,
  UsageSnapshotRepository,
  type UsageAlert,
  type UsageOverview,
  type UsageSnapshot,
} from "./model";

export interface UsageCommands {
  overview(reason: "overview" | "refresh"): Promise<UsageOverview>;
  setAlert(request: IpcRequest<"usage:alertSet">): UsageAlert;
}

interface HarnessRateLimit {
  rateLimitType?: string;
  resetsAt?: number;
  status?: string;
}

// The Claude CLI opens with trust/renderer modals, so scraping /usage is
// unreliable. Our own harness sessions already receive rate_limit events;
// when the scrape yields nothing, that real signal fills the snapshot.
function claudeWithHarnessLimits(
  state: AppState,
  snapshot: UsageSnapshot,
): UsageSnapshot {
  if (snapshot.windows.length > 0) return snapshot;
  const row = state.database
    .prepare(
      `SELECT payload_json, occurred_at FROM events
       WHERE kind = 'rate_limit_updated'
       ORDER BY occurred_at DESC LIMIT 1`,
    )
    .get() as { payload_json: string; occurred_at: string } | undefined;
  if (!row) return snapshot;
  let info: HarnessRateLimit | undefined;
  try {
    const payload = JSON.parse(row.payload_json) as {
      rateLimit?: { rate_limit_info?: HarnessRateLimit };
    };
    info = payload.rateLimit?.rate_limit_info;
  } catch {
    return snapshot;
  }
  if (!info?.rateLimitType) return snapshot;
  const weekly = info.rateLimitType === "weekly";
  return {
    ...snapshot,
    error: null,
    freshness: "partial",
    windows: [
      {
        durationMinutes: weekly ? 10_080 : 300,
        kind: weekly ? "weekly" : "five_hour",
        label: weekly ? "Semanal" : "5 horas",
        modelGroup: null,
        // The event reports the window and its reset, never a percentage.
        remainingPercent: info.status === "allowed" ? 100 : 0,
        resetsAt:
          typeof info.resetsAt === "number"
            ? new Date(info.resetsAt * 1000).toISOString()
            : null,
        usedPercent: info.status === "allowed" ? 0 : 100,
      },
    ],
  };
}

export function createUsageCommands(state: AppState): UsageCommands {
  if (
    typeof (state.database as unknown as { transaction?: unknown })
      .transaction !== "function"
  ) {
    return unavailableUsageCommands(state);
  }
  const snapshots = new UsageSnapshotRepository(state.database, state.createId);
  const activity = new UsageActivityService(state.database);
  const codex = new CodexUsageCollector({ clock: state.clock });
  const claude = new ClaudeUsageCollector({ clock: state.clock });
  return {
    async overview(reason) {
      const previous = snapshots.readLatest();
      const [codexSnapshot, claudeSnapshot] = await Promise.all([
        codex.collect({
          previous: previous.find((entry) => entry.provider === "chatgpt"),
          reason,
        }),
        claude.collect({
          previous: previous.find((entry) => entry.provider === "claude_max"),
          reason,
        }),
      ]);
      snapshots.save(codexSnapshot);
      snapshots.save(claudeWithHarnessLimits(state, claudeSnapshot));
      activity.rebuild();
      const latest = snapshots.readLatest();
      const localContext = activity.readSessionContext();
      const nativeContext = latest.find(
        (snapshot) => snapshot.provider === "claude_max",
      )?.sessionContext;
      return {
        activity: activity.readBuckets(),
        alerts: readUsageAlerts(state),
        context:
          localContext.freshness === "unavailable" && nativeContext
            ? nativeContext
            : localContext,
        generatedAt: state.clock().toISOString(),
        subscriptions: latest.map(publicSnapshot),
      };
    },
    setAlert(request) {
      const alert = { ...request };
      state.database
        .prepare(
          `INSERT INTO audit_entries
           (id, task_id, lane_id, run_id, actor, action, decision, capability,
            resource_json, metadata_json, occurred_at)
           VALUES (?, NULL, NULL, NULL, 'user', 'usage.alert_set', 'saved',
                   NULL, '{}', ?, ?)`,
        )
        .run(
          state.createId(),
          JSON.stringify(alert),
          state.clock().toISOString(),
        );
      return alert;
    },
  };
}

function publicSnapshot(snapshot: UsageSnapshot): UsageSnapshot {
  const result = { ...snapshot };
  delete result.sessionContext;
  return result;
}

function unavailableUsageCommands(state: AppState): UsageCommands {
  return {
    async overview() {
      const now = state.clock().toISOString();
      return {
        activity: [],
        alerts: [],
        context: {
          collectedAt: now,
          freshness: "unavailable",
          laneId: null,
          remainingTokens: null,
          source: {
            adapterVersion: "event-v1",
            kind: UsageSourceKind.Unavailable,
            method: "native session usage events",
          },
          usedPercent: null,
        },
        generatedAt: now,
        subscriptions: [],
      };
    },
    setAlert(request) {
      return { ...request };
    },
  };
}

function readUsageAlerts(state: AppState): UsageAlert[] {
  const rows = state.database
    .prepare(
      `SELECT metadata_json FROM audit_entries
       WHERE action = 'usage.alert_set'
       ORDER BY occurred_at DESC, id DESC`,
    )
    .all() as Array<{ metadata_json: string }>;
  const alerts = new Map<string, UsageAlert>();
  for (const row of rows) {
    const candidate = JSON.parse(row.metadata_json) as UsageAlert;
    const key = `${candidate.provider}:${candidate.accountRef}`;
    if (!alerts.has(key)) alerts.set(key, candidate);
  }
  return [...alerts.values()];
}
