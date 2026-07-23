type UsageRecord = Record<string, unknown>;

interface Totals {
  input: number;
  cacheRead: number;
  cacheCreation: number;
  output: number;
  reasoning: number;
  observed: number;
  cost: number;
  hasCost: boolean;
}

export class TurnUsageAccumulator {
  private readonly lanes = new Map<string, Totals>();

  record(laneId: string, usage: UsageRecord): void {
    const current = this.lanes.get(laneId) ?? emptyTotals();
    current.input += count(usage.input_tokens);
    current.cacheRead += count(usage.cache_read_input_tokens);
    current.cacheCreation += count(usage.cache_creation_input_tokens);
    current.output += count(usage.output_tokens);
    current.reasoning += count(usage.reasoning_tokens);
    current.observed += count(usage.observed_total_tokens);
    if (isCount(usage.cost_usd)) {
      current.cost += usage.cost_usd;
      current.hasCost = true;
    }
    this.lanes.set(laneId, current);
  }

  drain(laneId: string): UsageRecord | undefined {
    const total = this.lanes.get(laneId);
    if (!total) return undefined;
    this.lanes.delete(laneId);
    return {
      aggregation: "snapshot",
      scope: "turn",
      source: "provider",
      complete: true,
      input_token_semantics: "includes_cache_read",
      input_tokens: total.input,
      cache_read_input_tokens: total.cacheRead,
      cache_creation_input_tokens: total.cacheCreation,
      output_tokens: total.output,
      reasoning_tokens: total.reasoning,
      observed_total_tokens: total.observed,
      ...(total.hasCost ? { cost_usd: roundCost(total.cost) } : {}),
    };
  }
}

function emptyTotals(): Totals {
  return {
    input: 0,
    cacheRead: 0,
    cacheCreation: 0,
    output: 0,
    reasoning: 0,
    observed: 0,
    cost: 0,
    hasCost: false,
  };
}

function count(value: unknown): number {
  return isCount(value) ? value : 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundCost(value: number): number {
  return Number(value.toFixed(12));
}
