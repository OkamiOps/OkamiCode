import type { UsageFreshness } from "./model";

interface PreflightLane {
  accountRef: string;
  capabilities: string[];
  health: "ready" | "degraded" | "unavailable";
  laneId: string;
}

interface PreflightSnapshot {
  accountRef: string;
  freshness: UsageFreshness;
  remainingPercent: number | null;
}

interface PreflightInput {
  hardStop: boolean;
  lanes: PreflightLane[];
  requiredCapabilities: string[];
  snapshots: PreflightSnapshot[];
}

export interface PreflightSuggestion {
  accountRef: string;
  laneId: string;
  reasons: string[];
  remainingPercent: number | null;
}

export interface PreflightResult {
  automaticSwitch: null;
  decision: "proceed" | "warning" | "blocked";
  suggestions: PreflightSuggestion[];
  warnings: string[];
}

export class PreflightService {
  evaluate(input: PreflightInput): PreflightResult {
    const warnings = snapshotWarnings(input.snapshots);
    const compatible = input.lanes.filter(
      (lane) =>
        lane.health !== "unavailable" &&
        input.requiredCapabilities.every((capability) =>
          lane.capabilities.includes(capability),
        ),
    );
    const snapshots = new Map(
      input.snapshots.map((snapshot) => [snapshot.accountRef, snapshot]),
    );
    const missingAccounts = new Set<string>();
    for (const lane of compatible) {
      if (!snapshots.has(lane.accountRef)) missingAccounts.add(lane.accountRef);
      if (lane.health === "degraded") {
        warnings.push(`A lane ${lane.laneId} está degradada.`);
      }
    }
    for (const accountRef of missingAccounts) {
      warnings.push(`A quota de ${accountRef} está indisponível.`);
    }
    if (compatible.length === 0 && !input.hardStop) {
      warnings.push(
        "Nenhuma lane saudável possui todas as capacidades solicitadas.",
      );
    }
    const ranked = compatible
      .map((lane) => suggestion(lane, snapshots.get(lane.accountRef)))
      .sort(compareSuggestions);
    const suggestions = ranked.map((candidate) => ({
      accountRef: candidate.accountRef,
      laneId: candidate.laneId,
      reasons: candidate.reasons,
      remainingPercent: candidate.remainingPercent,
    }));
    return {
      automaticSwitch: null,
      decision: input.hardStop
        ? "blocked"
        : warnings.length > 0
          ? "warning"
          : "proceed",
      suggestions,
      warnings: input.hardStop
        ? ["A política hard_stop impede o início desta execução.", ...warnings]
        : warnings,
    };
  }
}

function snapshotWarnings(snapshots: PreflightSnapshot[]): string[] {
  return snapshots.flatMap((snapshot) => {
    const warnings: string[] = [];
    if (snapshot.freshness === "stale") {
      warnings.push(`A quota de ${snapshot.accountRef} está stale.`);
    } else if (snapshot.freshness === "unavailable") {
      warnings.push(`A quota de ${snapshot.accountRef} está indisponível.`);
    } else if (snapshot.freshness === "partial") {
      warnings.push(`A quota de ${snapshot.accountRef} está parcial.`);
    }
    if (snapshot.remainingPercent !== null && snapshot.remainingPercent <= 10) {
      warnings.push(
        `A quota de ${snapshot.accountRef} está baixa (${snapshot.remainingPercent}% restante).`,
      );
    }
    return warnings;
  });
}

function suggestion(
  lane: PreflightLane,
  snapshot: PreflightSnapshot | undefined,
): PreflightSuggestion & { rank: number } {
  const freshness = snapshot?.freshness ?? "unavailable";
  const healthReason =
    lane.health === "ready" ? "runtime saudável" : "runtime degradado";
  const quotaReason = snapshot
    ? `${freshness}; ${snapshot.remainingPercent ?? "quota"} restante`
    : "quota indisponível";
  return {
    accountRef: lane.accountRef,
    laneId: lane.laneId,
    rank:
      freshnessRank(freshness) * 10_000 +
      (lane.health === "ready" ? 1_000 : 0) +
      (snapshot?.remainingPercent ?? 0),
    reasons: [healthReason, quotaReason],
    remainingPercent: snapshot?.remainingPercent ?? null,
  };
}

function compareSuggestions(
  left: PreflightSuggestion & { rank: number },
  right: PreflightSuggestion & { rank: number },
): number {
  return right.rank - left.rank || left.laneId.localeCompare(right.laneId);
}

function freshnessRank(freshness: UsageFreshness): number {
  return {
    live: 5,
    estimated: 4,
    partial: 3,
    stale: 2,
    unavailable: 1,
  }[freshness];
}
