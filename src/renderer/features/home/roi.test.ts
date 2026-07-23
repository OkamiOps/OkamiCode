import { describe, expect, it } from "vitest";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { calculateRoi, defaultSubscriptionPrices } from "./roi";

type Activity = IpcResponse<"usage:overview">["activity"][number];

describe("calculateRoi", () => {
  it("projects a short canonical sample but refuses a cancellation verdict before seven days", () => {
    const result = calculateRoi(
      [
        activity({
          bucketStart: "2026-07-21T20:00:00.000Z",
          model: "gpt-5.6-luna",
          runtime: "codex",
        }),
      ],
      catalog(),
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const openai = result.rows.find((row) => row.id === "openai")!;
    expect(openai.observedDays).toBe(1);
    expect(openai.observedEquivalentUsd).toBeCloseTo(7.4905, 3);
    expect(openai.apiEquivalentUsd).toBeCloseTo(7.4905 * 30, 2);
    expect(openai.isProjected).toBe(true);
    expect(openai.verdict).toBe("insufficient");
    expect(result.observedDays).toBe(1);
    expect(result.observedEquivalentTotalUsd).toBeCloseTo(7.4905, 3);
  });

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
    expect(result.subscriptionTotalUsd).toBe(410);
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

  it("includes Antigravity and prices only its observed model telemetry", () => {
    const result = calculateRoi(
      [
        activity({
          model: "gemini-3.6-flash",
          provider: "antigravity",
          runtime: "agy",
        }),
      ],
      {
        ...catalog(),
        models: [
          {
            id: "google/gemini-3.6-flash",
            name: "Gemini 3.6 Flash",
            promptPerToken: 0.000001,
            completionPerToken: 0.000004,
            cacheReadPerToken: 0.0000001,
            reasoningPerToken: null,
            requestCost: null,
          },
        ],
      },
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const antigravity = result.rows.find((row) => row.id === "antigravity")!;
    expect(antigravity).toMatchObject({
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
      outputTokens: 1_000_000,
      observedTokens: 3_000_000,
      coveragePercent: 100,
    });
    expect(antigravity.apiEquivalentUsd).toBeCloseTo(5.3805, 6);
  });

  it("maps Antigravity effort suffixes to the priced Gemini model", () => {
    const result = calculateRoi(
      [
        activity({
          cachedInputTokens: 0,
          inputTokens: 0,
          model: "gemini-3.6-flash-low",
          outputTokens: 1_000,
          provider: "antigravity",
          runtime: "agy",
        }),
      ],
      {
        ...catalog(),
        models: [
          {
            id: "google/gemini-3.6-flash",
            name: "Gemini 3.6 Flash",
            promptPerToken: 0.000001,
            completionPerToken: 0.000004,
            cacheReadPerToken: null,
            reasoningPerToken: null,
            requestCost: null,
          },
        ],
      },
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const antigravity = result.rows.find((row) => row.id === "antigravity")!;
    expect(antigravity.coveragePercent).toBe(100);
    expect(antigravity.apiEquivalentUsd).toBeGreaterThan(0);
  });

  it("prices Claude aliases against the provider latest model", () => {
    const result = calculateRoi(
      [activity({ model: "sonnet", runtime: "claude" })],
      {
        ...catalog(),
        models: [
          {
            id: "~anthropic/claude-sonnet-latest",
            name: "Anthropic Claude Sonnet Latest",
            promptPerToken: 0.000002,
            completionPerToken: 0.00001,
            cacheReadPerToken: 0.0000002,
            reasoningPerToken: null,
            requestCost: null,
          },
        ],
      },
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const anthropic = result.rows.find((row) => row.id === "anthropic")!;
    expect(anthropic.coveragePercent).toBe(100);
    expect(anthropic.apiEquivalentUsd).toBeCloseTo(12.871, 3);
  });

  it("prices decorated Claude context-window model ids against their base model", () => {
    const result = calculateRoi(
      [activity({ model: "claude-fable-5[1m]", runtime: "claude" })],
      {
        ...catalog(),
        models: [
          {
            id: "anthropic/claude-fable-5",
            name: "Anthropic Claude Fable 5",
            promptPerToken: 0.000003,
            completionPerToken: 0.000015,
            cacheReadPerToken: 0.0000003,
            reasoningPerToken: null,
            requestCost: null,
          },
        ],
      },
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const anthropic = result.rows.find((row) => row.id === "anthropic")!;
    expect(anthropic.coveragePercent).toBe(100);
    expect(anthropic.apiEquivalentUsd).toBeCloseTo(19.3065, 3);
  });

  it("uses the newest priced Opus version and exposes fresh input, cache and output separately", () => {
    const result = calculateRoi(
      [
        activity({
          cachedInputTokens: 200_000,
          inputTokens: 4_000_000,
          model: "opus[1m]",
          outputTokens: 70_200,
          runtime: "claude",
        }),
      ],
      {
        ...catalog(),
        models: [
          {
            id: "anthropic/claude-opus-4.1",
            name: "Claude Opus 4.1",
            promptPerToken: 0.000003,
            completionPerToken: 0.000015,
            cacheReadPerToken: 0.0000003,
            reasoningPerToken: null,
            requestCost: null,
          },
          {
            id: "anthropic/claude-opus-4.8",
            name: "Claude Opus 4.8",
            promptPerToken: 0.000005,
            completionPerToken: 0.000025,
            cacheReadPerToken: 0.0000005,
            reasoningPerToken: null,
            requestCost: null,
          },
        ],
      },
      defaultSubscriptionPrices(),
      new Date("2026-07-21T22:00:00.000Z"),
    );

    const anthropic = result.rows.find((row) => row.id === "anthropic")!;
    expect(anthropic.inputTokens).toBe(4_000_000);
    expect(anthropic.cachedInputTokens).toBe(200_000);
    expect(anthropic.outputTokens).toBe(70_200);
    expect(anthropic.models[0]).toMatchObject({
      activityModel: "opus[1m]",
      pricingModel: "anthropic/claude-opus-4.8",
      inputTokens: 4_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 70_200,
      costUsd: 21.855,
    });
    expect(anthropic.apiEquivalentUsd).toBeCloseTo(23.057025, 6);
  });
});

function activity(
  overrides: Partial<Activity> & Pick<Activity, "model" | "runtime">,
): Activity {
  return {
    bucketStart: "2026-06-22T20:00:00.000Z",
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
