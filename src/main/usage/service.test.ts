import { describe, expect, it } from "vitest";
import { UsageSourceKind, type UsageSnapshot } from "./model";
import { completeUsageCoverage } from "./service";

const collected: UsageSnapshot = {
  accountLabel: "ChatGPT",
  accountRef: "chatgpt",
  collectedAt: "2026-07-22T00:00:00.000Z",
  credits: null,
  error: null,
  freshness: "live",
  plan: "Pro",
  provider: "chatgpt",
  runtime: "codex",
  source: {
    adapterVersion: "fixture",
    kind: UsageSourceKind.OfficialStructured,
    method: "fixture",
  },
  validUntil: null,
  windows: [],
};

describe("completeUsageCoverage", () => {
  it("keeps collected quotas and exposes every configured provider honestly", () => {
    const result = completeUsageCoverage(
      [collected],
      "2026-07-22T01:00:00.000Z",
    );

    expect(result.map((entry) => entry.provider)).toEqual([
      "chatgpt",
      "claude_max",
      "cursor",
      "antigravity",
      "grok",
      "mimo",
      "minimax",
    ]);
    expect(result[0]).toBe(collected);
    expect(result.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "grok",
          runtime: "grok",
          freshness: "unavailable",
          windows: [],
        }),
        expect.objectContaining({
          provider: "minimax",
          runtime: "minimax",
          freshness: "unavailable",
          windows: [],
        }),
      ]),
    );
  });
});
