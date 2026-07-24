import { describe, expect, it, vi } from "vitest";
import type { AppState } from "../ipc/app-state";
import { UsageSourceKind, type UsageSnapshot } from "./model";
import { completeUsageCoverage, createUsageCommands } from "./service";

const locateLocalBinary = vi.hoisted(() =>
  vi.fn((client: string) => {
    if (client !== "claude") {
      throw new Error(`Host lookup forbidden for ${client}`);
    }
    return null;
  }),
);

vi.mock("../ecosystem/cli-capabilities", () => ({ locateLocalBinary }));

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

  it("wires usage collectors from managed commands without host discovery", () => {
    const state = {
      database: { transaction: () => undefined },
      clock: () => new Date("2026-07-24T12:00:00.000Z"),
      createId: () => "usage-id",
    } as unknown as AppState;

    expect(() =>
      createUsageCommands(state, {
        claude: null,
        codex: "/managed/codex",
        cursor: "/managed/cursor-agent",
        agy: "/managed/agy",
        grok: "/managed/grok",
      }),
    ).not.toThrow();
    expect(locateLocalBinary).not.toHaveBeenCalled();
  });
});
