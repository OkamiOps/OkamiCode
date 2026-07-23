import { describe, expect, it } from "vitest";
import type { CanonicalEventKind } from "../../shared/contracts/event";
import { builtInRuntimeManifests } from "./manifest";

type UsageState = "numeric" | "unavailable" | "not-reported";

interface FixtureEvent {
  kind: CanonicalEventKind;
  payload: Record<string, unknown>;
}

const fixtures: Record<keyof typeof builtInRuntimeManifests, FixtureEvent[]> = {
  claude: turnWithNumericUsage(),
  codex: turnWithNumericUsage(),
  cursor: turnWithNumericUsage(),
  agy: turnWithUnavailableUsage(),
  grok: turnWithNumericUsage(),
  mimo: turnWithNumericUsage(),
  minimax: turnWithNumericUsage(),
  opencode: [
    {
      kind: "usage_reported",
      payload: {
        runtime: "opencode",
        usage: {
          available: false,
          source: "opencode_acp_context_only",
        },
        context: { used_tokens: 120, size_tokens: 2_000 },
      },
    },
    { kind: "run_completed", payload: {} },
  ],
};

describe("built-in runtime conformance", () => {
  it.each(Object.keys(builtInRuntimeManifests) as Array<keyof typeof fixtures>)(
    "%s terminates once and reports a truthful usage state",
    (runtime) => {
      const events = fixtures[runtime];
      expect(terminalEvents(events)).toHaveLength(1);
      expect(usageState(events)).toMatch(
        /^(?:numeric|unavailable|not-reported)$/u,
      );
    },
  );

  it("has one fixture for every built-in runtime", () => {
    expect(Object.keys(fixtures).sort()).toEqual(
      Object.keys(builtInRuntimeManifests).sort(),
    );
  });
});

function turnWithNumericUsage(): FixtureEvent[] {
  return [
    {
      kind: "usage_reported",
      payload: {
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    },
    { kind: "run_completed", payload: {} },
  ];
}

function turnWithUnavailableUsage(): FixtureEvent[] {
  return [
    {
      kind: "usage_reported",
      payload: { usage: { available: false, source: "cli" } },
    },
    { kind: "run_completed", payload: {} },
  ];
}

function terminalEvents(events: FixtureEvent[]): FixtureEvent[] {
  return events.filter((event) =>
    ["run_completed", "run_failed", "run_cancelled"].includes(event.kind),
  );
}

function usageState(events: FixtureEvent[]): UsageState {
  const reported = events.find((event) => event.kind === "usage_reported");
  const usage =
    reported?.payload.usage &&
    typeof reported.payload.usage === "object" &&
    !Array.isArray(reported.payload.usage)
      ? (reported.payload.usage as Record<string, unknown>)
      : null;
  if (!usage) return "not-reported";
  if (usage.available === false) return "unavailable";
  return Object.entries(usage).some(
    ([key, value]) =>
      key.endsWith("_tokens") &&
      typeof value === "number" &&
      Number.isFinite(value),
  )
    ? "numeric"
    : "not-reported";
}
