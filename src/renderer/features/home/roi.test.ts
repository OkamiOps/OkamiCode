import { describe, expect, it } from "vitest";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { calculateRoi, defaultSubscriptionPrices } from "./roi";

type Activity = IpcResponse<"usage:overview">["activity"][number];

describe("calculateRoi", () => {
  it("prices exact observed models over the last 30 days and includes OpenRouter fees", () => {
    const result = calculateRoi(
      [activity({ model: "gpt-5.6-luna", runtime: "codex" })],
      catalog(),
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const openai = result.rows.find((row) => row.id === "openai")!;
    expect(openai.apiEquivalentUsd).toBeCloseTo(7.4905, 3);
    expect(openai.coveragePercent).toBe(100);
    expect(openai.verdict).toBe("api");
    expect(result.subscriptionTotalUsd).toBe(370);
  });

  it("reports unavailable telemetry and unmatched models instead of inventing zero cost", () => {
    const result = calculateRoi(
      [activity({ model: "private-build", runtime: "claude" })],
      catalog(),
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const anthropic = result.rows.find((row) => row.id === "anthropic")!;
    const grok = result.rows.find((row) => row.id === "grok")!;
    expect(anthropic.apiEquivalentUsd).toBeNull();
    expect(anthropic.coveragePercent).toBe(0);
    expect(anthropic.verdict).toBe("insufficient");
    expect(grok.apiEquivalentUsd).toBeNull();
    expect(grok.coveragePercent).toBeNull();
  });
});

function activity(
  overrides: Partial<Activity> & Pick<Activity, "model" | "runtime">,
): Activity {
  return {
    bucketStart: "2026-07-21T20:00:00.000Z",
    cachedInputTokens: 1_000_000,
    durationMs: 1_000,
    inputTokens: 1_000_000,
    laneId: "lane-1",
    messages: 1,
    modelCalls: 1,
    outputTokens: 1_000_000,
    provider: overrides.runtime === "claude" ? "claude_max" : "chatgpt",
    reasoningTokens: 0,
    sessions: 1,
    taskId: "task-1",
    toolCalls: 0,
    ...overrides,
  };
}

function catalog(): IpcResponse<"usage:openRouterPricing"> {
  return {
    fetchedAt: "2026-07-21T20:00:00.000Z",
    sourceUrl: "https://openrouter.ai/api/v1/models",
    models: [
      {
        id: "openai/gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        promptPerToken: 0.000001,
        completionPerToken: 0.000006,
        cacheReadPerToken: 0.0000001,
        reasoningPerToken: null,
        requestCost: null,
      },
    ],
  };
}
