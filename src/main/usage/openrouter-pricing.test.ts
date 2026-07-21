import { describe, expect, it, vi } from "vitest";
import { OpenRouterPricingService } from "./openrouter-pricing";

describe("OpenRouterPricingService", () => {
  it("normalizes public per-token prices and caches the catalog", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "~openai/gpt-test",
              name: "GPT Test",
              pricing: {
                prompt: "0.000001",
                completion: "0.000006",
                input_cache_read: "0.0000001",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const service = new OpenRouterPricingService(
      fetcher,
      () => new Date("2026-07-21T20:00:00.000Z"),
    );

    const first = await service.list();
    const second = await service.list();

    expect(first.models[0]).toEqual({
      id: "openai/gpt-test",
      name: "GPT Test",
      promptPerToken: 0.000001,
      completionPerToken: 0.000006,
      cacheReadPerToken: 0.0000001,
      reasoningPerToken: null,
      requestCost: null,
    });
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
