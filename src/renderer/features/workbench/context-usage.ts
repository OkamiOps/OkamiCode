import type { SessionUsage } from "./store";

export interface ContextDescription {
  label: string;
  percent: number | null;
  breakdown: Array<{ label: string; value: string; tone: string }>;
}

export function describeSessionContext(
  usage: SessionUsage | undefined,
  model: string,
): ContextDescription | null {
  if (!usage) return null;
  const accountingTotal =
    usage.inputTokens + usage.cacheReadTokens + usage.outputTokens;
  if (
    accountingTotal === 0 &&
    (usage.contextTokens === null || usage.contextTokens === undefined)
  )
    return null;

  const compact = (value: number) =>
    value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`;
  const breakdown = [
    {
      label: "Entrada faturada",
      value: compact(usage.inputTokens),
      tone: "input",
    },
    {
      label: "Cache faturado",
      value: compact(usage.cacheReadTokens),
      tone: "cache",
    },
    {
      label: "Saída faturada",
      value: compact(usage.outputTokens),
      tone: "output",
    },
  ];
  const window =
    usage.contextWindow ??
    (model.includes("[1m]")
      ? 1_000_000
      : /claude|opus|sonnet|haiku|default/iu.test(model)
        ? 200_000
        : null);

  if (
    usage.contextTokens === null ||
    usage.contextTokens === undefined ||
    !window
  ) {
    return { label: "janela indisponível", percent: null, breakdown };
  }

  return {
    label: `${compact(usage.contextTokens)}/${compact(window)} tokens`,
    percent: Math.min(100, Math.round((usage.contextTokens / window) * 100)),
    breakdown,
  };
}
