import type { IpcRequest } from "../../shared/contracts/ipc";
import type { AppState } from "../ipc/app-state";
import { UsageActivityService } from "./activity";
import { ClaudeUsageCollector } from "./claude-collector";
import { CodexUsageCollector } from "./codex-collector";
import { MiniMaxUsageCollector } from "./minimax-collector";
import { CursorUsageCollector } from "./cursor-collector";
import { GrokUsageCollector } from "./grok-collector";
import { locateLocalBinary } from "../ecosystem/cli-capabilities";
import {
  UsageSourceKind,
  UsageSnapshotRepository,
  type UsageAlert,
  type UsageOverview,
  type UsageSnapshot,
} from "./model";

const SUBSCRIPTION_COVERAGE: Array<
  Pick<
    UsageSnapshot,
    "accountLabel" | "accountRef" | "provider" | "runtime"
  > & {
    error: string;
  }
> = [
  {
    accountLabel: "ChatGPT",
    accountRef: "chatgpt",
    provider: "chatgpt",
    runtime: "codex",
    error: "O Codex ainda não informou uma leitura de quota.",
  },
  {
    accountLabel: "Claude Max",
    accountRef: "claude-max",
    provider: "claude_max",
    runtime: "claude",
    error: "O Claude Code ainda não informou uma leitura de quota.",
  },
  {
    accountLabel: "Cursor",
    accountRef: "cursor",
    provider: "cursor",
    runtime: "cursor",
    error: "O Cursor CLI ainda não informou uma leitura de quota.",
  },
  {
    accountLabel: "Antigravity",
    accountRef: "antigravity",
    provider: "antigravity",
    runtime: "agy",
    error:
      "O AGY não expõe quota estruturada; a atividade local continua disponível.",
  },
  {
    accountLabel: "Grok",
    accountRef: "grok",
    provider: "grok",
    runtime: "grok",
    error: "O Grok CLI ainda não informou uma leitura de quota.",
  },
  {
    accountLabel: "MiMo Code",
    accountRef: "mimo",
    provider: "mimo",
    runtime: "mimo",
    error:
      "O MiMo Code não expõe quota estruturada; a atividade local continua disponível.",
  },
  {
    accountLabel: "MiniMax",
    accountRef: "minimax",
    provider: "minimax",
    runtime: "minimax",
    error: "O MiniMax Token Plan ainda não informou uma leitura de quota.",
  },
];

export interface UsageCommands {
  overview(reason: "overview" | "refresh"): Promise<UsageOverview>;
  setAlert(request: IpcRequest<"usage:alertSet">): UsageAlert;
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
  const codex = new CodexUsageCollector({
    clock: state.clock,
    command: locateLocalBinary("codex") ?? undefined,
  });
  const claude = new ClaudeUsageCollector({
    clock: state.clock,
    command: locateLocalBinary("claude") ?? undefined,
  });
  const cursor = new CursorUsageCollector({ clock: state.clock });
  const grok = new GrokUsageCollector({ clock: state.clock });
  const minimax = new MiniMaxUsageCollector({ clock: state.clock });
  return {
    async overview(reason) {
      const previous = snapshots.readLatest();
      const [
        codexSnapshot,
        claudeSnapshot,
        cursorSnapshot,
        grokSnapshot,
        minimaxSnapshot,
      ] = await Promise.all([
        codex.collect({
          previous: previous.find((entry) => entry.provider === "chatgpt"),
          reason,
        }),
        claude.collect({
          previous: previous.find((entry) => entry.provider === "claude_max"),
          reason,
        }),
        cursor.collect({
          previous: previous.find((entry) => entry.provider === "cursor"),
          reason,
        }),
        grok.collect({
          previous: previous.find((entry) => entry.provider === "grok"),
          reason,
        }),
        minimax.collect(),
      ]);
      snapshots.save(codexSnapshot);
      snapshots.save(claudeSnapshot);
      snapshots.save(cursorSnapshot);
      snapshots.save(grokSnapshot);
      snapshots.save(minimaxSnapshot);
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
        subscriptions: completeUsageCoverage(
          latest.map(publicSnapshot),
          state.clock().toISOString(),
        ),
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

export function completeUsageCoverage(
  snapshots: UsageSnapshot[],
  collectedAt: string,
): UsageSnapshot[] {
  const byProvider = new Map(
    snapshots.map((snapshot) => [snapshot.provider, snapshot]),
  );
  return SUBSCRIPTION_COVERAGE.map((entry) => {
    const snapshot = byProvider.get(entry.provider);
    if (snapshot) return snapshot;
    return {
      accountLabel: entry.accountLabel,
      accountRef: entry.accountRef,
      collectedAt,
      credits: null,
      error: entry.error,
      freshness: "unavailable",
      plan: null,
      provider: entry.provider,
      runtime: entry.runtime,
      source: {
        adapterVersion: "coverage-v1",
        kind: UsageSourceKind.Unavailable,
        method: "provider does not expose structured subscription quota",
      },
      validUntil: null,
      windows: [],
    };
  });
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
