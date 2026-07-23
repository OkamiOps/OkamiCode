import { describe, expect, it } from "vitest";
import { TurnUsageAccumulator } from "./turn-usage";

describe("TurnUsageAccumulator", () => {
  it("combines every provider model call and drains once per lane turn", () => {
    const usage = new TurnUsageAccumulator();
    usage.record("lane-chatgpt", {
      input_tokens: 100,
      cache_read_input_tokens: 40,
      output_tokens: 10,
      observed_total_tokens: 110,
      cost_usd: 0.001,
    });
    usage.record("lane-chatgpt", {
      input_tokens: 200,
      cache_read_input_tokens: 80,
      output_tokens: 20,
      observed_total_tokens: 220,
      cost_usd: 0.002,
    });

    expect(usage.drain("lane-chatgpt")).toEqual({
      aggregation: "snapshot",
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 120,
      complete: true,
      cost_usd: 0.003,
      input_token_semantics: "includes_cache_read",
      input_tokens: 300,
      observed_total_tokens: 330,
      output_tokens: 30,
      reasoning_tokens: 0,
      scope: "turn",
      source: "provider",
    });
    expect(usage.drain("lane-chatgpt")).toBeUndefined();
  });
});
