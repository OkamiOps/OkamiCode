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

// Mirrors how Claude and Codex report quota: every window as a labelled bar
// of what was consumed, with its reset, instead of one "remaining" number.
function usageTone(used: number): "ok" | "warn" | "high" {
  if (used >= 85) return "high";
  if (used >= 60) return "warn";
  return "ok";
}

function countdown(resetsAt: string | null): string {
  if (!resetsAt) return "reset indisponível";
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return "reset indisponível";
  const minutes = Math.round((target - Date.now()) / 60_000);
  if (minutes <= 0) return "reiniciando";
  if (minutes < 60) return `reinicia em ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return `reinicia em ${hours} h${rest > 0 ? ` ${rest} min` : ""}`;
  }
  return `reinicia ${formatReset(resetsAt)}`;
}

export function SubscriptionCards({ subscriptions }: SubscriptionTableProps) {
  return (
    <div className="usage-cards">
      {subscriptions.map((subscription) => {
        const runtime = runtimePresentation(subscription);
        const windows = [...subscription.windows].sort(
          (left, right) => (right.usedPercent ?? 0) - (left.usedPercent ?? 0),
        );
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
              {subscription.plan && (
                <span className="usage-card__plan">{subscription.plan}</span>
              )}
              <span
                className={`freshness-pill freshness-pill--${freshnessTone(subscription.freshness)}`}
              >
                {freshnessLabel(subscription.freshness)}
              </span>
            </header>
            {windows.length === 0 ? (
              <p className="usage-card__empty">
                {subscription.error ?? "sem fonte de quota"}
              </p>
            ) : (
              <ul className="usage-meters">
                {windows.map((window) => {
                  const used = window.usedPercent;
                  return (
                    <li className="usage-meter" key={window.label}>
                      <div className="usage-meter__head">
                        <span className="usage-meter__label">
                          {window.label}
                        </span>
                        <strong className="usage-meter__value">
                          {used === null ? "—" : `${formatNumber(used)}% usado`}
                        </strong>
                      </div>
                      <div
                        aria-hidden="true"
                        className="usage-meter__track"
                        data-tone={used === null ? "ok" : usageTone(used)}
                      >
                        <i style={{ width: `${Math.max(0, used ?? 0)}%` }} />
                      </div>
                      <span className="usage-meter__reset">
                        {countdown(window.resetsAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
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

function runtimePresentation(subscription: UsageSnapshot) {
  if (subscription.provider === "chatgpt") {
    return { glyph: "GP", tone: "gpt" } as const;
  }
  if (subscription.provider === "claude_max") {
    return { glyph: "CL", tone: "claude" } as const;
  }
  if (subscription.provider === "cursor") {
    return { glyph: "CU", tone: "cursor" } as const;
  }
  if (subscription.provider === "antigravity") {
    return { glyph: "AG", tone: "task" } as const;
  }
  if (subscription.provider === "grok") {
    return { glyph: "GK", tone: "task" } as const;
  }
  if (subscription.provider === "mimo") {
    return { glyph: "MI", tone: "task" } as const;
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
