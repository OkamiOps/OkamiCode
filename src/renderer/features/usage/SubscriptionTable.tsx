import { Chip } from "@heroui/react";
import type { UsageSnapshotContract } from "../../../shared/contracts/ipc";

type UsageSnapshot = UsageSnapshotContract;
type UsageWindow = UsageSnapshot["windows"][number];

interface SubscriptionTableProps {
  subscriptions: UsageSnapshot[];
}

export function SourceFreshness({
  snapshot,
}: {
  snapshot: Pick<UsageSnapshot, "freshness" | "source">;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ok-text-muted)]">
      {snapshot.source.kind} · {snapshot.freshness}
    </span>
  );
}

export function SubscriptionTable({ subscriptions }: SubscriptionTableProps) {
  const rows = subscriptions.flatMap<{
    subscription: UsageSnapshot;
    window: UsageWindow | null;
  }>((subscription) =>
    subscription.windows.length > 0
      ? subscription.windows.map((window) => ({ subscription, window }))
      : [{ subscription, window: null }],
  );

  return (
    <div className="overflow-x-auto rounded-[var(--ok-radius-md)] border border-[var(--ok-border)]">
      <table className="w-full min-w-[720px] border-collapse text-left text-xs">
        <thead className="bg-[var(--ok-surface-2)] text-[10px] uppercase tracking-[0.08em] text-[var(--ok-text-muted)]">
          <tr>
            <th className="px-3 py-2.5" scope="col">
              Assinatura
            </th>
            <th className="px-3 py-2.5" scope="col">
              Janela
            </th>
            <th className="px-3 py-2.5" scope="col">
              Quota da assinatura
            </th>
            <th className="px-3 py-2.5" scope="col">
              Próximo reset
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ subscription, window }, index) => (
            <SubscriptionRow
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
  subscription,
  window,
}: {
  subscription: UsageSnapshot;
  window: UsageWindow | null;
}) {
  return (
    <tr className="border-t border-[var(--ok-border)] bg-[var(--ok-surface-1)] align-top">
      <td className="px-3 py-3">
        <strong className="block font-semibold text-[var(--ok-text)]">
          {subscription.accountLabel}
        </strong>
        <span className="mt-1 block text-[10px] text-[var(--ok-text-muted)]">
          {subscription.plan ?? "Plano não informado"} · {subscription.runtime}
        </span>
      </td>
      <td className="px-3 py-3 text-[var(--ok-text-muted)]">
        {window?.label ?? "Sem janela legível"}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="tabular-nums text-[var(--ok-text)]">
            {quotaLabel(window)}
          </strong>
          <Chip
            className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[10px] text-[var(--ok-text-muted)]"
            size="sm"
            variant="secondary"
          >
            <SourceFreshness snapshot={subscription} />
          </Chip>
        </div>
        {subscription.error && (
          <p className="mb-0 mt-1 max-w-[320px] text-[10px] leading-4 text-[var(--ok-yellow)]">
            {subscription.error}
          </p>
        )}
      </td>
      <td className="px-3 py-3 tabular-nums text-[var(--ok-text-muted)]">
        {window?.resetsAt ? formatReset(window.resetsAt) : "reset indisponível"}
      </td>
    </tr>
  );
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
