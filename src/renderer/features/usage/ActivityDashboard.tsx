import { Card } from "@heroui/react";
import { Activity, CalendarDays, Flame } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { UsageActivityBucketContract } from "../../../shared/contracts/ipc";

type UsageActivityBucket = UsageActivityBucketContract;

interface ActivityDashboardProps {
  activity: UsageActivityBucket[];
}

interface Stat {
  label: string;
  value: string;
}

export function ActivityDashboard({ activity }: ActivityDashboardProps) {
  const [filter, setFilter] = useState("all");
  const options = useMemo(() => activityFilters(activity), [activity]);
  const filtered = useMemo(
    () =>
      filter === "all"
        ? activity
        : activity.filter(
            (bucket) => bucket.runtime === filter || bucket.provider === filter,
          ),
    [activity, filter],
  );
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const heatmap = useMemo(() => calendarData(filtered), [filtered]);
  const maxTokens = Math.max(1, ...heatmap.map((day) => day.tokens));

  return (
    <section
      aria-labelledby="activity-dashboard-heading"
      className="activity-dashboard"
    >
      <header className="activity-dashboard__header">
        <div>
          <div className="flex items-center gap-2 text-[var(--ok-orange)]">
            <Flame aria-hidden="true" size={15} />
            <p className="pane-kicker m-0">Seu ritmo no Workbench</p>
          </div>
          <h2
            className="mb-0 mt-1 text-lg font-semibold tracking-[-0.025em]"
            id="activity-dashboard-heading"
          >
            Atividade local
          </h2>
          <p className="mb-0 mt-1 text-[11px] text-[var(--ok-text-muted)]">
            local_estimate · estimated · somente event log local
          </p>
        </div>
        <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ok-text-muted)]">
          Runtime ou provider
          <select
            aria-label="Filtrar atividade"
            className="h-9 min-w-44 rounded-[var(--ok-radius-sm)] border border-[var(--ok-border)] bg-[var(--ok-bg)] px-2.5 text-xs normal-case tracking-normal text-[var(--ok-text)]"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="activity-stat-grid">
        {summary.stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} />
        ))}
      </div>

      <div className="activity-calendar">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays
              aria-hidden="true"
              className="text-[var(--ok-cyan)]"
              size={15}
            />
            <h3 className="m-0 text-sm font-semibold">
              Calendário de atividade
            </h3>
          </div>
          <span className="text-[10px] text-[var(--ok-text-muted)]">
            local_estimate · estimated
          </span>
        </div>
        <div
          aria-label="Heatmap de atividade local"
          className="h-[220px] min-w-0 overflow-hidden rounded-[var(--ok-radius-md)] bg-[var(--ok-bg)]"
          role="img"
        >
          <ResponsiveContainer height="100%" minWidth={280} width="100%">
            <ScatterChart margin={{ bottom: 12, left: 8, right: 12, top: 12 }}>
              <XAxis dataKey="week" domain={[0, 52]} hide type="number" />
              <YAxis
                dataKey="weekday"
                domain={[0, 6]}
                hide
                reversed
                type="number"
              />
              <ZAxis dataKey="tokens" range={[32, 90]} type="number" />
              <Tooltip
                cursor={{ stroke: "var(--ok-border)", strokeWidth: 1 }}
                formatter={(value) => [formatNumber(Number(value)), "tokens"]}
                labelFormatter={(_, payload) =>
                  String(payload[0]?.payload?.date ?? "Sem atividade")
                }
              />
              <Scatter data={heatmap} shape="square">
                {heatmap.map((day) => (
                  <Cell
                    fill={heatColor(day.tokens, maxTokens)}
                    key={day.date}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function StatCard({ stat }: { stat: Stat }) {
  return (
    <Card className="activity-stat-card">
      <Card.Content>
        <header>
          <Activity aria-hidden="true" size={13} />
          <strong>{stat.label}</strong>
          <span className="freshness-pill freshness-pill--stale">
            estimated
          </span>
        </header>
        <p className="activity-stat-card__value">{stat.value}</p>
        <p className="activity-stat-card__source">local_estimate · estimated</p>
      </Card.Content>
    </Card>
  );
}

function summarize(activity: UsageActivityBucket[]) {
  const totalTokens = activity.reduce(
    (total, bucket) => total + tokens(bucket),
    0,
  );
  const sessions = sum(activity, "sessions");
  const dayTotals = group(activity, (bucket) =>
    bucket.bucketStart.slice(0, 10),
  );
  const modelTotals = group(activity, (bucket) => bucket.model);
  const hourTotals = group(activity, (bucket) =>
    bucket.bucketStart.slice(11, 13),
  );
  const taskDurations = group(
    activity,
    (bucket) => bucket.taskLabel ?? bucket.taskId,
    "durationMs",
  );
  const streaks = streak([...dayTotals.keys()]);
  return {
    stats: [
      { label: "Tokens totais", value: formatNumber(totalTokens) },
      {
        label: "Sessões",
        value: `${formatNumber(sessions)} ${sessions === 1 ? "sessão" : "sessões"}`,
      },
      { label: "Mensagens", value: formatNumber(sum(activity, "messages")) },
      { label: "Dias ativos", value: formatNumber(dayTotals.size) },
      { label: "Sequência atual", value: `${streaks.current} dias` },
      { label: "Maior sequência", value: `${streaks.longest} dias` },
      {
        label: "Horário de pico",
        value: peak(hourTotals, "—", (hour) => `${hour}h`),
      },
      { label: "Modelo favorito", value: peak(modelTotals, "—") },
      { label: "Tarefa mais longa", value: peak(taskDurations, "—") },
    ] satisfies Stat[],
  };
}

function calendarData(activity: UsageActivityBucket[]) {
  const daily = group(activity, (bucket) => bucket.bucketStart.slice(0, 10));
  const latest = activity.length
    ? new Date(
        Math.max(...activity.map((bucket) => Date.parse(bucket.bucketStart))),
      )
    : new Date();
  latest.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: 365 }, (_, offset) => {
    const date = new Date(latest);
    date.setUTCDate(latest.getUTCDate() - (364 - offset));
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      tokens: daily.get(key) ?? 0,
      week: Math.floor(offset / 7),
      weekday: date.getUTCDay(),
    };
  });
}

function activityFilters(activity: UsageActivityBucket[]) {
  const runtimes = [...new Set(activity.map((bucket) => bucket.runtime))];
  const providers = [...new Set(activity.map((bucket) => bucket.provider))];
  return [
    { label: "Geral · todos os CLIs", value: "all" },
    ...runtimes.map((runtime) => ({
      label: `CLI · ${label(runtime)}`,
      value: runtime,
    })),
    ...providers.map((provider) => ({
      label: `Provider · ${label(provider)}`,
      value: provider,
    })),
  ];
}

function group(
  activity: UsageActivityBucket[],
  key: (bucket: UsageActivityBucket) => string,
  field?: "durationMs",
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const bucket of activity) {
    totals.set(
      key(bucket),
      (totals.get(key(bucket)) ?? 0) + (field ? bucket[field] : tokens(bucket)),
    );
  }
  return totals;
}

function streak(days: string[]) {
  const ordered = [...new Set(days)].sort();
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const day of ordered) {
    run = previous && dayDifference(previous, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return { current: run, longest };
}

function dayDifference(left: string, right: string): number {
  return Math.round((Date.parse(right) - Date.parse(left)) / 86_400_000);
}

function peak(
  values: Map<string, number>,
  fallback: string,
  format = (value: string) => value,
): string {
  const winner = [...values].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  return winner ? format(winner[0]) : fallback;
}

function sum(
  activity: UsageActivityBucket[],
  field: "messages" | "sessions",
): number {
  return activity.reduce((total, bucket) => total + bucket[field], 0);
}

function tokens(bucket: UsageActivityBucket): number {
  return (
    bucket.inputTokens +
    bucket.cachedInputTokens +
    bucket.outputTokens +
    bucket.reasoningTokens
  );
}

function heatColor(value: number, max: number): string {
  if (value === 0) return "var(--ok-surface-3)";
  const ratio = value / max;
  if (ratio > 0.75) return "var(--ok-orange)";
  if (ratio > 0.5) return "var(--ok-yellow)";
  if (ratio > 0.25) return "var(--ok-green)";
  return "var(--ok-cyan)";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function label(value: string): string {
  return value === "claude_max"
    ? "Claude Max"
    : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
