import { z } from "zod";
import {
  openRouterPricingCatalogSchema,
  type IpcResponse,
} from "../../shared/contracts/ipc";

const sourceUrl = "https://openrouter.ai/api/v1/models" as const;
const cacheTtlMs = 6 * 60 * 60 * 1_000;

const apiResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().optional(),
          pricing: z
            .object({
              prompt: z.string(),
              completion: z.string(),
              input_cache_read: z.string().optional(),
              internal_reasoning: z.string().optional(),
              request: z.string().optional(),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

type PricingCatalog = IpcResponse<"usage:openRouterPricing">;

export class OpenRouterPricingService {
  private cached: PricingCatalog | null = null;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(): Promise<PricingCatalog> {
    const now = this.clock();
    if (
      this.cached &&
      now.getTime() - Date.parse(this.cached.fetchedAt) < cacheTtlMs
    ) {
      return this.cached;
    }

    const response = await this.fetcher(sourceUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(
        `OpenRouter pricing request failed (${response.status}).`,
      );
    }
    const payload = apiResponseSchema.parse(await response.json());
    const catalog = openRouterPricingCatalogSchema.parse({
      fetchedAt: now.toISOString(),
      sourceUrl,
      models: payload.data.flatMap((model) => {
        const prompt = amount(model.pricing.prompt);
        const completion = amount(model.pricing.completion);
        if (prompt === null || completion === null) return [];
        return [
          {
            id: model.id.replace(/^~/u, ""),
            name: model.name?.trim() || model.id,
            promptPerToken: prompt,
            completionPerToken: completion,
            cacheReadPerToken: amount(model.pricing.input_cache_read),
            reasoningPerToken: amount(model.pricing.internal_reasoning),
            requestCost: amount(model.pricing.request),
          },
        ];
      }),
    });
    this.cached = catalog;
    return catalog;
  }
}

function amount(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
