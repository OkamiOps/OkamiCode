import type { IpcResponse } from "../../../shared/contracts/ipc";

type Activity = IpcResponse<"usage:overview">["activity"][number];
type Catalog = IpcResponse<"usage:openRouterPricing">;

export const subscriptionDefaults = [
  { id: "openai", label: "OpenAI", monthlyUsd: 200 },
  { id: "anthropic", label: "Anthropic", monthlyUsd: 100 },
  { id: "minimax", label: "MiniMax", monthlyUsd: 20 },
  { id: "cursor", label: "Cursor", monthlyUsd: 20 },
  { id: "grok", label: "Grok", monthlyUsd: 30 },
] as const;

export type SubscriptionId = (typeof subscriptionDefaults)[number]["id"];
export type SubscriptionPrices = Record<SubscriptionId, number>;

export interface RoiRow {
  id: SubscriptionId;
  label: string;
  subscriptionUsd: number;
  apiEquivalentUsd: number | null;
  observedTokens: number;
  pricedTokens: number;
  coveragePercent: number | null;
  verdict: "subscription" | "api" | "insufficient";
}

export interface RoiSummary {
  rows: RoiRow[];
  subscriptionTotalUsd: number;
  apiEquivalentTotalUsd: number;
  observedTokens: number;
  pricedTokens: number;
  coveragePercent: number | null;
}

export function defaultSubscriptionPrices(): SubscriptionPrices {
  return Object.fromEntries(
    subscriptionDefaults.map((item) => [item.id, item.monthlyUsd]),
  ) as SubscriptionPrices;
}

export function calculateRoi(
  activity: Activity[],
  catalog: Catalog | null,
  subscriptions: SubscriptionPrices,
  now = new Date(),
): RoiSummary {
  const start = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
  const recent = activity.filter(
    (bucket) => Date.parse(bucket.bucketStart) >= start,
  );
  const accumulators = new Map<
    SubscriptionId,
    { observed: number; priced: number; cost: number }
  >();
  for (const plan of subscriptionDefaults) {
    accumulators.set(plan.id, { observed: 0, priced: 0, cost: 0 });
  }

  for (const bucket of recent) {
    const planId = subscriptionFor(bucket);
    if (!planId) continue;
    const accumulator = accumulators.get(planId)!;
    const tokens = tokenTotal(bucket);
    accumulator.observed += tokens;
    const pricing = catalog ? matchPricing(bucket.model, catalog.models) : null;
    if (!pricing) continue;
    accumulator.priced += tokens;
    accumulator.cost +=
      bucket.inputTokens * pricing.promptPerToken +
      bucket.cachedInputTokens *
        (pricing.cacheReadPerToken ?? pricing.promptPerToken) +
      bucket.outputTokens * pricing.completionPerToken +
      bucket.reasoningTokens *
        (pricing.reasoningPerToken ?? pricing.completionPerToken) +
      bucket.modelCalls * (pricing.requestCost ?? 0);
  }

  const rows = subscriptionDefaults.map((plan): RoiRow => {
    const values = accumulators.get(plan.id)!;
    const coverage = percent(values.priced, values.observed);
    const equivalent =
      values.observed > 0 && values.priced > 0 ? values.cost * 1.055 : null;
    const verdict =
      equivalent === null || coverage === null || coverage < 80
        ? "insufficient"
        : equivalent >= subscriptions[plan.id]
          ? "subscription"
          : "api";
    return {
      id: plan.id,
      label: plan.label,
      subscriptionUsd: subscriptions[plan.id],
      apiEquivalentUsd: equivalent,
      observedTokens: values.observed,
      pricedTokens: values.priced,
      coveragePercent: coverage,
      verdict,
    };
  });
  const observedTokens = rows.reduce((sum, row) => sum + row.observedTokens, 0);
  const pricedTokens = rows.reduce((sum, row) => sum + row.pricedTokens, 0);
  return {
    rows,
    subscriptionTotalUsd: rows.reduce(
      (sum, row) => sum + row.subscriptionUsd,
      0,
    ),
    apiEquivalentTotalUsd: rows.reduce(
      (sum, row) => sum + (row.apiEquivalentUsd ?? 0),
      0,
    ),
    observedTokens,
    pricedTokens,
    coveragePercent: percent(pricedTokens, observedTokens),
  };
}

function subscriptionFor(bucket: Activity): SubscriptionId | null {
  if (bucket.runtime === "cursor") return "cursor";
  if (bucket.runtime === "codex") return "openai";
  if (bucket.runtime === "claude") return "anthropic";
  const model = normalize(bucket.model);
  if (model.includes("minimax")) return "minimax";
  if (model.includes("grok")) return "grok";
  return null;
}

function matchPricing(model: string, catalog: Catalog["models"]) {
  const target = normalize(model);
  if (!target || target === "default") return null;
  return (
    catalog.find((candidate) => normalize(slug(candidate.id)) === target) ??
    null
  );
}

function slug(id: string): string {
  return id.split("/").at(-1) ?? id;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/^~/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function tokenTotal(bucket: Activity): number {
  return (
    bucket.inputTokens +
    bucket.cachedInputTokens +
    bucket.outputTokens +
    bucket.reasoningTokens
  );
}

function percent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}
