import type { IpcResponse } from "../../../shared/contracts/ipc";

type Activity = IpcResponse<"usage:overview">["activity"][number];
type Catalog = IpcResponse<"usage:openRouterPricing">;

export const subscriptionDefaults = [
  { id: "openai", label: "OpenAI", monthlyUsd: 200 },
  { id: "anthropic", label: "Anthropic", monthlyUsd: 100 },
  { id: "minimax", label: "MiniMax", monthlyUsd: 20 },
  { id: "mimo", label: "Xiaomi MiMo", monthlyUsd: 20 },
  { id: "cursor", label: "Cursor", monthlyUsd: 20 },
  { id: "antigravity", label: "Antigravity", monthlyUsd: 20 },
  { id: "grok", label: "Grok", monthlyUsd: 30 },
] as const;

export type SubscriptionId = (typeof subscriptionDefaults)[number]["id"];
export type SubscriptionPrices = Record<SubscriptionId, number>;

export interface RoiRow {
  id: SubscriptionId;
  label: string;
  subscriptionUsd: number;
  apiEquivalentUsd: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  observedTokens: number;
  pricedTokens: number;
  coveragePercent: number | null;
  verdict: "subscription" | "api" | "insufficient";
  models: RoiModelBreakdown[];
}

export interface RoiModelBreakdown {
  activityModel: string;
  pricingModel: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  promptPerMillion: number | null;
  cacheReadPerMillion: number | null;
  completionPerMillion: number | null;
  costUsd: number | null;
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
    {
      observed: number;
      priced: number;
      cost: number;
      input: number;
      cachedInput: number;
      output: number;
      models: Map<string, RoiModelBreakdown>;
    }
  >();
  for (const plan of subscriptionDefaults) {
    accumulators.set(plan.id, {
      observed: 0,
      priced: 0,
      cost: 0,
      input: 0,
      cachedInput: 0,
      output: 0,
      models: new Map(),
    });
  }

  for (const bucket of recent) {
    const planId = subscriptionFor(bucket);
    if (!planId) continue;
    const accumulator = accumulators.get(planId)!;
    const tokens = tokenTotal(bucket);
    accumulator.observed += tokens;
    accumulator.input += bucket.inputTokens;
    accumulator.cachedInput += bucket.cachedInputTokens;
    accumulator.output += bucket.outputTokens + bucket.reasoningTokens;
    const pricing = catalog ? matchPricing(bucket.model, catalog.models) : null;
    const breakdown = accumulator.models.get(bucket.model) ?? {
      activityModel: bucket.model,
      pricingModel: pricing?.id ?? null,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      promptPerMillion: pricing ? pricing.promptPerToken * 1_000_000 : null,
      cacheReadPerMillion: pricing
        ? (pricing.cacheReadPerToken ?? pricing.promptPerToken) * 1_000_000
        : null,
      completionPerMillion: pricing
        ? pricing.completionPerToken * 1_000_000
        : null,
      costUsd: pricing ? 0 : null,
    };
    breakdown.inputTokens += bucket.inputTokens;
    breakdown.cachedInputTokens += bucket.cachedInputTokens;
    breakdown.outputTokens += bucket.outputTokens;
    breakdown.reasoningTokens += bucket.reasoningTokens;
    accumulator.models.set(bucket.model, breakdown);
    if (!pricing) continue;
    accumulator.priced += tokens;
    const bucketCost =
      bucket.inputTokens * pricing.promptPerToken +
      bucket.cachedInputTokens *
        (pricing.cacheReadPerToken ?? pricing.promptPerToken) +
      bucket.outputTokens * pricing.completionPerToken +
      bucket.reasoningTokens *
        (pricing.reasoningPerToken ?? pricing.completionPerToken) +
      bucket.modelCalls * (pricing.requestCost ?? 0);
    accumulator.cost += bucketCost;
    breakdown.costUsd = (breakdown.costUsd ?? 0) + bucketCost;
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
      inputTokens: values.input,
      cachedInputTokens: values.cachedInput,
      outputTokens: values.output,
      observedTokens: values.observed,
      pricedTokens: values.priced,
      coveragePercent: coverage,
      verdict,
      models: [...values.models.values()].sort(
        (left, right) =>
          (right.costUsd ?? -1) - (left.costUsd ?? -1) ||
          left.activityModel.localeCompare(right.activityModel),
      ),
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
  if (bucket.runtime === "agy") return "antigravity";
  if (bucket.runtime === "cursor") return "cursor";
  if (bucket.runtime === "codex") return "openai";
  if (bucket.runtime === "claude") return "anthropic";
  if (bucket.runtime === "mimo") return "mimo";
  const model = normalize(bucket.model);
  if (model.includes("minimax")) return "minimax";
  if (model.includes("grok")) return "grok";
  return null;
}

function matchPricing(model: string, catalog: Catalog["models"]) {
  const target = normalize(model);
  if (!target || target === "default") return null;
  const normalized = catalog.map((candidate) => ({
    candidate,
    id: normalize(slug(candidate.id)),
  }));
  const exact = normalized.find(({ id }) => id === target)?.candidate;
  if (exact) return exact;

  const targetWithoutEffort = target.replace(
    /-(?:low|medium|high|xhigh)$/u,
    "",
  );
  const effortAgnostic = normalized.find(
    ({ id }) =>
      id === targetWithoutEffort ||
      id.startsWith(`${targetWithoutEffort}-`) ||
      targetWithoutEffort.startsWith(`${id}-`),
  )?.candidate;
  if (effortAgnostic) return effortAgnostic;

  // Native CLIs decorate canonical model IDs with context windows or dated
  // variants (for example `claude-fable-5[1m]`). OpenRouter prices the base
  // model, so retain that exact family/version before considering aliases.
  const base = normalized.find(
    ({ id }) => target.startsWith(`${id}-`) || id.startsWith(`${target}-`),
  )?.candidate;
  if (base) return base;

  const claudeAlias = claudeModelAlias(target);
  if (!claudeAlias) return null;
  const preferred = preferredClaudePricingId(claudeAlias);
  const preferredMatch = normalized.find(
    ({ id }) => id === preferred,
  )?.candidate;
  if (preferredMatch) return preferredMatch;
  const latest = `claude-${claudeAlias}-latest`;
  return (
    normalized.find(({ id }) => id === latest)?.candidate ??
    newestClaudeFamilyModel(claudeAlias, normalized) ??
    null
  );
}

function preferredClaudePricingId(family: string): string {
  // Prefer the concrete versions exposed by the installed Claude catalog.
  // This keeps pricing auditable instead of depending on API response order.
  return (
    (
      {
        fable: "claude-fable-5",
        opus: "claude-opus-4-8",
        sonnet: "claude-sonnet-5",
        haiku: "claude-haiku-4-5",
      } as Record<string, string>
    )[family] ?? `claude-${family}`
  );
}

function newestClaudeFamilyModel(
  family: string,
  normalized: Array<{
    candidate: Catalog["models"][number];
    id: string;
  }>,
) {
  return normalized
    .filter(({ id }) => id.startsWith(`claude-${family}-`))
    .sort((left, right) => compareVersion(right.id, left.id))[0]?.candidate;
}

function compareVersion(left: string, right: string): number {
  const a = left.match(/\d+/gu)?.map(Number) ?? [];
  const b = right.match(/\d+/gu)?.map(Number) ?? [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.localeCompare(right);
}

function claudeModelAlias(model: string): string | null {
  for (const family of ["fable", "opus", "sonnet", "haiku"]) {
    if (
      model === family ||
      model === `claude-${family}` ||
      model.startsWith(`${family}-`) ||
      model.startsWith(`claude-${family}-`)
    )
      return family;
  }
  return null;
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
