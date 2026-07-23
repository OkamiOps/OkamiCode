export type UsageAggregation = "delta" | "snapshot";
export type UsageScope = "model_call" | "turn";
export type InputTokenSemantics =
  "excludes_cache_read" | "includes_cache_read" | "unknown";
export type ReasoningTokenSemantics =
  "excludes_output" | "includes_output" | "unknown";

export interface CanonicalTurnUsageInput {
  aggregation: UsageAggregation;
  scope: UsageScope;
  inputTokenSemantics: InputTokenSemantics;
  reasoningTokenSemantics?: ReasoningTokenSemantics;
  inputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  reportedTotalTokens?: number;
  costUsd?: number;
  complete?: boolean;
}

export function canonicalTurnUsage(
  input: CanonicalTurnUsageInput,
): Record<string, unknown> | undefined {
  const inputTokens = tokenCount(input.inputTokens);
  const cacheReadInputTokens = tokenCount(input.cacheReadInputTokens);
  const cacheCreationInputTokens = tokenCount(input.cacheCreationInputTokens);
  const outputTokens = tokenCount(input.outputTokens);
  const reasoningTokens = tokenCount(input.reasoningTokens);
  const reportedTotalTokens = tokenCount(input.reportedTotalTokens);
  const costUsd = nonnegative(input.costUsd);
  if (
    inputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    outputTokens === undefined &&
    reasoningTokens === undefined &&
    reportedTotalTokens === undefined
  ) {
    return undefined;
  }

  const observedTotalTokens =
    (inputTokens ?? 0) +
    (input.inputTokenSemantics === "includes_cache_read"
      ? 0
      : (cacheReadInputTokens ?? 0) + (cacheCreationInputTokens ?? 0)) +
    (outputTokens ?? 0) +
    (input.reasoningTokenSemantics === "excludes_output"
      ? (reasoningTokens ?? 0)
      : 0);

  return {
    aggregation: input.aggregation,
    complete: input.complete ?? true,
    input_token_semantics: input.inputTokenSemantics,
    ...(reasoningTokens === undefined
      ? {}
      : {
          reasoning_token_semantics: input.reasoningTokenSemantics ?? "unknown",
        }),
    ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
    ...(cacheReadInputTokens === undefined
      ? {}
      : { cache_read_input_tokens: cacheReadInputTokens }),
    ...(cacheCreationInputTokens === undefined
      ? {}
      : { cache_creation_input_tokens: cacheCreationInputTokens }),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
    ...(reasoningTokens === undefined
      ? {}
      : { reasoning_tokens: reasoningTokens }),
    observed_total_tokens: observedTotalTokens,
    ...(reportedTotalTokens === undefined
      ? {}
      : { reported_total_tokens: reportedTotalTokens }),
    scope: input.scope,
    source: "provider",
    ...(costUsd === undefined ? {} : { cost_usd: costUsd }),
  };
}

export function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isInteger(value)
    ? value
    : undefined;
}

function nonnegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
