import { Popover } from "@heroui/react";
import { ArrowUpRight, Gauge } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  UsageOverviewContract,
  UsageSnapshotContract,
} from "../../../shared/contracts/ipc";
import { SourceFreshness } from "./SubscriptionTable";

type UsageOverview = UsageOverviewContract;
type UsageSnapshot = UsageSnapshotContract;

interface UsageQuickPopoverProps {
  overview?: UsageOverview;
}

export function UsageQuickPopover({ overview }: UsageQuickPopoverProps) {
  const context = overview?.context;
  const restrictive = mostRestrictive(overview?.subscriptions ?? []);
  const nextReset = nearestReset(overview?.subscriptions ?? []);
  const alert = restrictive
    ? overview?.alerts.find(
        (candidate) =>
          candidate.provider === restrictive.snapshot.provider &&
          candidate.accountRef === restrictive.snapshot.accountRef,
      )
    : overview?.alerts[0];

  return (
    <Popover.Root>
      <Popover.Trigger aria-label="Abrir resumo de uso" className="icon-button">
        <Gauge aria-hidden="true" size={16} />
      </Popover.Trigger>
      <Popover.Content
        className="z-50 w-[300px] border border-[var(--ok-border)] bg-[var(--ok-surface-1)] text-[var(--ok-text)] shadow-2xl"
        placement="left top"
      >
        <Popover.Dialog className="p-3.5">
          <Popover.Heading className="text-sm font-semibold">
            Uso rápido
          </Popover.Heading>
          <dl className="mt-3 grid gap-2.5">
            <QuickValue
              label="Contexto da sessão"
              source={
                context
                  ? `${context.source.kind} · ${context.freshness}`
                  : "unavailable · unavailable"
              }
              value={
                context?.usedPercent === null ||
                context?.usedPercent === undefined
                  ? "contexto indisponível"
                  : `${format(context.usedPercent)}% usado`
              }
            />
            <QuickValue
              label="Janela mais restritiva"
              source={restrictive ? undefined : "unavailable · unavailable"}
              sourceNode={
                restrictive ? (
                  <SourceFreshness snapshot={restrictive.snapshot} />
                ) : undefined
              }
              value={
                restrictive
                  ? `${format(restrictive.remainingPercent)}% restante`
                  : "quota indisponível"
              }
            />
            <QuickValue
              label="Próximo reset"
              source={
                nextReset
                  ? `${nextReset.snapshot.source.kind} · ${nextReset.snapshot.freshness}`
                  : "unavailable · unavailable"
              }
              value={
                nextReset
                  ? new Intl.DateTimeFormat("pt-BR", {
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      month: "short",
                    }).format(new Date(nextReset.resetsAt))
                  : "reset indisponível"
              }
            />
            <QuickValue
              label="Alerta"
              source="configuração local · live"
              value={
                alert?.enabled
                  ? `${format(alert.remainingPercent)}% restante`
                  : "sem alerta configurado"
              }
            />
          </dl>
          <Link
            className="mt-3 flex min-h-9 items-center justify-between rounded-[var(--ok-radius-sm)] border border-[var(--ok-border)] bg-[var(--ok-surface-2)] px-3 text-xs font-semibold text-[var(--ok-cyan)] no-underline"
            to="/usage"
          >
            Abrir Uso e limites
            <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </Popover.Dialog>
      </Popover.Content>
    </Popover.Root>
  );
}

function QuickValue({
  label,
  source,
  sourceNode,
  value,
}: {
  label: string;
  source?: string;
  sourceNode?: ReactNode;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-[var(--ok-border)] pb-2">
      <dt className="text-[10px] text-[var(--ok-text-muted)]">{label}</dt>
      <dd className="m-0 text-right text-xs font-semibold tabular-nums">
        {value}
      </dd>
      <dd className="col-span-2 m-0 mt-0.5 text-[9px] text-[var(--ok-text-muted)]">
        {sourceNode ?? source}
      </dd>
    </div>
  );
}

function mostRestrictive(subscriptions: UsageSnapshot[]) {
  return subscriptions
    .flatMap((snapshot) =>
      snapshot.windows.flatMap((window) =>
        window.remainingPercent === null
          ? []
          : [{ remainingPercent: window.remainingPercent, snapshot }],
      ),
    )
    .sort((left, right) => left.remainingPercent - right.remainingPercent)[0];
}

function nearestReset(subscriptions: UsageSnapshot[]) {
  return subscriptions
    .flatMap((snapshot) =>
      snapshot.windows.flatMap((window) =>
        window.resetsAt ? [{ resetsAt: window.resetsAt, snapshot }] : [],
      ),
    )
    .sort(
      (left, right) => Date.parse(left.resetsAt) - Date.parse(right.resetsAt),
    )[0];
}

function format(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    value,
  );
}
