import { describe, expect, it } from "vitest";
import type { UsageOverviewContract } from "../../../shared/contracts/ipc";
import { summarizeProviderUsage } from "./UsagePopover";

const subscriptions: UsageOverviewContract["subscriptions"] = [
  {
    accountLabel: "ChatGPT",
    accountRef: "chatgpt",
    collectedAt: "2026-07-22T11:00:00.000Z",
    credits: null,
    error: null,
    freshness: "live",
    plan: "Pro",
    provider: "chatgpt",
    runtime: "codex",
    source: {
      adapterVersion: "test",
      kind: "official_structured",
      method: "fixture",
    },
    validUntil: null,
    windows: [
      {
        durationMinutes: 10_080,
        kind: "weekly",
        label: "Semanal",
        modelGroup: null,
        remainingPercent: 80,
        resetsAt: null,
        usedPercent: 20,
      },
    ],
  },
  {
    accountLabel: "Cursor",
    accountRef: "cursor",
    collectedAt: "2026-07-22T11:00:00.000Z",
    credits: null,
    error: null,
    freshness: "live",
    plan: "Pro",
    provider: "cursor",
    runtime: "cursor",
    source: {
      adapterVersion: "test",
      kind: "native_presentational",
      method: "fixture",
    },
    validUntil: null,
    windows: [
      {
        durationMinutes: 43_200,
        kind: "monthly",
        label: "Mensal · API",
        modelGroup: "API",
        remainingPercent: 0,
        resetsAt: null,
        usedPercent: 100,
      },
    ],
  },
];

describe("UsagePopover provider focus", () => {
  it("summarizes the active provider instead of the most consumed provider", () => {
    const summary = summarizeProviderUsage(subscriptions, "chatgpt");

    expect(summary?.snapshot.provider).toBe("chatgpt");
    expect(summary?.usedPercent).toBe(20);
    expect(summary?.remainingPercent).toBe(80);
  });

  it("does not invent a provider when no lane is selected", () => {
    expect(summarizeProviderUsage(subscriptions, null)).toBeNull();
  });
});
