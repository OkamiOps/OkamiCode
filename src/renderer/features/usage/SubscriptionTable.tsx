import type {
  UsageActivityBucketContract,
  UsageSnapshotContract,
} from "../../../shared/contracts/ipc";

type UsageSnapshot = UsageSnapshotContract;
type UsageWindow = UsageSnapshot["windows"][number];

interface SubscriptionTableProps {
  activity?: UsageActivityBucketContract[];
  subscriptions: UsageSnapshot[];
}

export function SourceFreshness({
  snapshot,
}: {
  snapshot: Pick<UsageSnapshot, "freshness" | "source">;
}) {
  return (
    <span
      className={`freshness-pill freshness-pill--${freshnessTone(snapshot.freshness)}`}
    >
      {snapshot.source.kind} · {snapshot.freshness}
    </span>
  );
}

export function SubscriptionCards({ subscriptions }: SubscriptionTableProps) {
  return (
    <div className="usage-cards">
      {subscriptions.map((subscription) => {
        const window = mostRestrictiveWindow(subscription.windows);
        const runtime = runtimePresentation(subscription);
        return (
          <article className="usage-card" key={subscription.accountRef}>
            <header>
              <span
                aria-hidden="true"
                className={`lane-glyph runtime-glyph--${runtime.tone}`}
              >
                {runtime.glyph}
              </span>
              <strong>{subscription.accountLabel}</strong>
              <span
                className={`freshness-pill freshness-pill--${freshnessTone(subscription.freshness)}`}
              >
                {freshnessLabel(subscription.freshness)}
              </span>
            </header>
            <p className="usage-card__value">
              {window?.remainingPercent === null ||
              window?.remainingPercent === undefined
                ? "—"
                : `${formatNumber(window.remainingPercent)}%`}
              <small>
                {window ? `restante · ${window.label}` : "sem fonte de quota"}
              </small>
            </p>
            <p className="usage-card__reset">
              {window?.resetsAt
                ? `reseta ${formatReset(window.resetsAt)}`
                : "reset indisponível"}{" "}
              · fonte: {subscription.source.kind}
            </p>
          </article>
        );
      })}
    </div>
  );
}

export function SubscriptionTable({
  activity = [],
  subscriptions,
}: SubscriptionTableProps) {
  const rows = subscriptions.flatMap<{
    subscription: UsageSnapshot;
    window: UsageWindow | null;
  }>((subscription) =>
    subscription.windows.length > 0
      ? subscription.windows.map((window) => ({ subscription, window }))
      : [{ subscription, window: null }],
  );

  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col">Assinatura</th>
            <th scope="col">Janela</th>
            <th scope="col">Quota da assinatura</th>
            <th scope="col">Próximo reset</th>
            <th scope="col">Fonte</th>
            <th scope="col">Atividade local (hoje)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ subscription, window }, index) => (
            <SubscriptionRow
              activity={activity}
              key={`${subscription.provider}:${subscription.accountRef}:${window?.label ?? index}`}
              subscription={subscription}
              window={window}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionRow({
  activity,
  subscription,
  window,
}: {
  activity: UsageActivityBucketContract[];
  subscription: UsageSnapshot;
  window: UsageWindow | null;
}) {
  const local = activity.filter(
    (bucket) =>
      bucket.provider === subscription.provider ||
      bucket.runtime === subscription.runtime,
  );
  const tokens = local.reduce(
    (total, bucket) =>
      total +
      bucket.inputTokens +
      bucket.cachedInputTokens +
      bucket.outputTokens +
      bucket.reasoningTokens,
    0,
  );
  const calls = local.reduce((total, bucket) => total + bucket.modelCalls, 0);

  return (
    <tr>
      <td>
        <strong>{subscription.accountLabel}</strong>
        <span className="usage-table__subline">
          {subscription.plan ?? "Plano não informado"} · {subscription.runtime}
        </span>
      </td>
      <td className="usage-table__mono">
        {window?.label ?? "Sem janela legível"}
      </td>
      <td>
        <div className="usage-table__quota">
          <span className="usage-progress" aria-hidden="true">
            <i
              className={`usage-progress__fill usage-progress__fill--${subscription.provider === "claude_max" ? "orange" : "cyan"}`}
              style={{ width: `${window?.usedPercent ?? 0}%` }}
            />
          </span>
          <strong className="usage-table__mono">{quotaLabel(window)}</strong>
        </div>
        {subscription.error && (
          <p className="usage-table__error">{subscription.error}</p>
        )}
      </td>
      <td className="usage-table__mono">
        {window?.resetsAt ? formatReset(window.resetsAt) : "reset indisponível"}
      </td>
      <td className="usage-table__mono">
        <SourceFreshness snapshot={subscription} />
      </td>
      <td className="usage-table__mono">
        {local.length ? `${formatNumber(tokens)} tok · ${calls} calls` : "—"}
      </td>
    </tr>
  );
}

function mostRestrictiveWindow(windows: UsageWindow[]) {
  return [...windows].sort(
    (left, right) =>
      (left.remainingPercent ?? Number.POSITIVE_INFINITY) -
      (right.remainingPercent ?? Number.POSITIVE_INFINITY),
  )[0];
}

function runtimePresentation(subscription: UsageSnapshot) {
  if (subscription.provider === "chatgpt") {
    return { glyph: "GP", tone: "gpt" } as const;
  }
  if (subscription.provider === "claude_max") {
    return { glyph: "CL", tone: "claude" } as const;
  }
  if (subscription.provider === "supergrok") {
    return { glyph: "GK", tone: "grok" } as const;
  }
  return { glyph: "MX", tone: "task" } as const;
}

function freshnessTone(freshness: UsageSnapshot["freshness"]) {
  if (freshness === "live") return "live";
  if (freshness === "unavailable") return "unavailable";
  return "stale";
}

function freshnessLabel(freshness: UsageSnapshot["freshness"]) {
  return freshness === "unavailable" ? "indisponível" : freshness;
}

function quotaLabel(window: UsageWindow | null): string {
  return window?.remainingPercent === null ||
    window?.remainingPercent === undefined
    ? "quota indisponível"
    : `${formatNumber(window.remainingPercent)}% restante`;
}

function formatReset(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    value,
  );
}
