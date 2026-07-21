import { Button, Skeleton, Tabs, Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { UsageSnapshotContract } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { UsageQuickPopover } from "../usage/UsageQuickPopover";
import type { WorkbenchLane } from "./api";
import { laneDisplayName, runtimePresentation } from "./runtime-presentation";

export { laneDisplayName } from "./runtime-presentation";

interface LaneSelectorProps {
  error: Error | null;
  isLoading: boolean;
  isOpening: boolean;
  lanes: WorkbenchLane[];
  onCollapse: () => void;
  onOpen: (laneId: string) => void;
  selectedLane: WorkbenchLane | null;
}

function harnessLabel(lane: WorkbenchLane): string {
  return lane.harness === "claude" ? "Claude Code" : "Runtime nativo";
}

function value(value: string | null): string {
  return value ?? "Não informado";
}

export function LaneSelector({
  error,
  isLoading,
  isOpening,
  lanes,
  onCollapse,
  onOpen,
  selectedLane,
}: LaneSelectorProps) {
  const hasBridge = typeof window !== "undefined" && "okami" in window;
  const usage = useQuery({
    enabled: hasBridge,
    queryFn: () => workbenchClient.usageOverview(),
    queryKey: ["usage", "quick-popover"],
    retry: false,
    staleTime: 60_000,
  });
  const usageOverview =
    usage.data && "generatedAt" in usage.data ? usage.data : undefined;
  const context = usageOverview?.context;

  return (
    <aside
      aria-label="Detalhes da lane"
      className="details-panel workbench-details"
    >
      <Tooltip.Root closeDelay={0} delay={300}>
        <Button
          aria-label="Recolher painel de detalhes"
          className="icon-button details-collapse"
          isIconOnly
          variant="ghost"
          onPress={onCollapse}
        >
          <ChevronRight aria-hidden="true" size={17} />
        </Button>
        <Tooltip.Content className="ok-tooltip" placement="left">
          Recolher detalhes
        </Tooltip.Content>
      </Tooltip.Root>
      <Tabs
        aria-label="Visualização de detalhes da lane"
        className="details-tabs details-tabs--workbench"
        defaultSelectedKey="details"
        variant="secondary"
      >
        <Tabs.List aria-label="Seções de detalhes da lane">
          <Tabs.Tab id="details">Detalhes</Tabs.Tab>
          <Tabs.Tab id="activity">Atividade</Tabs.Tab>
          <Tabs.Tab id="sources">Fontes</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="details">
          <div className="details-scroll">
            {selectedLane && (
              <section className="detail-group">
                <h3>Lane ativa</h3>
                <DetailRow label="Harness" value={harnessLabel(selectedLane)} />
                <DetailRow
                  label="Provider"
                  value={selectedLane.providerAccountLabel}
                />
                <DetailRow label="Modelo" value={selectedLane.model} />
                <DetailRow
                  label="Rota"
                  value={
                    <span
                      className={`route-badge route-badge--${selectedLane.routeKind}`}
                    >
                      {selectedLane.routeKind}
                    </span>
                  }
                />
                <DetailRow
                  label="Consumindo"
                  value={selectedLane.displayQuotaAccount}
                />
                <DetailRow
                  label="Sessão nativa"
                  mono
                  value={value(selectedLane.nativeSessionIdPrefix)}
                />
                <DetailRow
                  label="Contexto da sessão"
                  mono
                  value={
                    context?.usedPercent === null ||
                    context?.usedPercent === undefined
                      ? "indisponível"
                      : `${format(context.usedPercent)}%`
                  }
                />
                <ProgressBar tone="cyan" value={context?.usedPercent ?? 0} />
                <SourceNote
                  freshness={context?.freshness ?? "unavailable"}
                  text={
                    context
                      ? `${context.source.kind} · ${context.freshness}`
                      : "fonte indisponível"
                  }
                />
              </section>
            )}

            <section className="detail-group">
              <div className="detail-group__heading">
                <h3>Quota das assinaturas</h3>
                <UsageQuickPopover overview={usageOverview} />
              </div>
              {usageOverview?.subscriptions.length ? (
                usageOverview.subscriptions.map((subscription) => (
                  <QuotaLine
                    key={subscription.accountRef}
                    subscription={subscription}
                  />
                ))
              ) : (
                <SourceNote freshness="unavailable" text="quota indisponível" />
              )}
            </section>

            {selectedLane && (
              <section className="detail-group">
                <h3>Workspace</h3>
                <DetailRow
                  label="Pasta"
                  mono
                  value={value(selectedLane.workspacePath)}
                />
                <DetailRow
                  label="Permissões"
                  value={value(selectedLane.permissionMode)}
                />
                <DetailRow label="Estado" value={selectedLane.status} />
                <DetailRow
                  label="Temperatura"
                  mono
                  value={selectedLane.temperature}
                />
              </section>
            )}

            <section className="detail-group">
              <h3>Lanes disponíveis</h3>
              <LaneList
                error={error}
                isLoading={isLoading}
                isOpening={isOpening}
                lanes={lanes}
                onOpen={onOpen}
                selectedLane={selectedLane}
              />
            </section>
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="activity">
          <div className="details-scroll">
            <section className="detail-group">
              <h3>Execução atual</h3>
              <DetailRow
                label="Estado"
                value={selectedLane?.status ?? "Sem lane"}
              />
              <DetailRow
                label="Eventos pendentes"
                mono
                value={String(selectedLane?.pendingDeltaEvents ?? 0)}
              />
            </section>
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="sources">
          <div className="details-scroll">
            <section className="detail-group">
              <h3>Fontes de quota</h3>
              {usageOverview?.subscriptions.map((subscription) => (
                <SourceNote
                  freshness={subscription.freshness}
                  key={subscription.accountRef}
                  text={`${subscription.accountLabel} · ${subscription.source.kind}`}
                />
              ))}
            </section>
          </div>
        </Tabs.Panel>
      </Tabs>
    </aside>
  );
}

function LaneList({
  error,
  isLoading,
  isOpening,
  lanes,
  onOpen,
  selectedLane,
}: Pick<
  LaneSelectorProps,
  "error" | "isLoading" | "isOpening" | "lanes" | "onOpen" | "selectedLane"
>) {
  if (isLoading) {
    return (
      <div className="grid gap-2" aria-label="Carregando lanes">
        <Skeleton className="h-16 rounded-[var(--ok-radius-md)]" />
        <Skeleton className="h-16 rounded-[var(--ok-radius-md)]" />
      </div>
    );
  }
  if (error) {
    return (
      <p className="detail-error" role="alert">
        Não foi possível carregar as lanes: {error.message}
      </p>
    );
  }
  if (lanes.length === 0) {
    return <p className="detail-empty">Nenhuma lane vinculada à tarefa.</p>;
  }
  return (
    <div className="detail-lane-list" aria-label="Lanes da tarefa">
      {lanes.map((lane) => {
        const selected = lane.laneId === selectedLane?.laneId;
        const runtime = runtimePresentation(lane);
        return (
          <div
            className="detail-lane-card"
            data-selected={selected}
            key={lane.laneId}
          >
            <span
              aria-hidden="true"
              className={`lane-glyph runtime-glyph--${runtime.tone}`}
            >
              {runtime.glyph}
            </span>
            <span className="detail-lane-card__meta">
              <strong>{laneDisplayName(lane)}</strong>
              <span>
                {lane.providerAccountLabel} · {lane.model}
              </span>
            </span>
            <span className={`route-badge route-badge--${lane.routeKind}`}>
              {lane.routeKind}
            </span>
            {!selected && (
              <Button
                className="detail-lane-card__action"
                isDisabled={isOpening}
                size="sm"
                variant="secondary"
                onPress={() => onOpen(lane.laneId)}
              >
                Mudar para {laneDisplayName(lane)}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({
  label,
  mono = false,
  value: detail,
}: {
  label: string;
  mono?: boolean;
  value: ReactNode;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong className={mono ? "detail-row__mono" : undefined}>
        {detail}
      </strong>
    </div>
  );
}

function QuotaLine({ subscription }: { subscription: UsageSnapshotContract }) {
  const window = subscription.windows[0];
  return (
    <div className="quota-line">
      <DetailRow
        label={`${subscription.accountLabel}${window ? ` · ${window.label}` : ""}`}
        mono
        value={
          window?.remainingPercent === null ||
          window?.remainingPercent === undefined
            ? "indisponível"
            : `${format(window.remainingPercent)}% rest.`
        }
      />
      <ProgressBar
        tone={subscription.provider === "claude_max" ? "orange" : "cyan"}
        value={window?.usedPercent ?? 0}
      />
      <SourceNote
        freshness={subscription.freshness}
        text={`${subscription.source.kind} · ${subscription.freshness}`}
      />
    </div>
  );
}

function ProgressBar({
  tone,
  value,
}: {
  tone: "cyan" | "orange";
  value: number;
}) {
  return (
    <span className="detail-progress" aria-hidden="true">
      <i
        className={`detail-progress__fill detail-progress__fill--${tone}`}
        style={{ width: `${value}%` }}
      />
    </span>
  );
}

function SourceNote({ freshness, text }: { freshness: string; text: string }) {
  const live = freshness === "live";
  return (
    <p className="detail-source-note">
      <span
        aria-hidden="true"
        className={
          live ? "source-dot source-dot--live" : "source-dot source-dot--stale"
        }
      />
      {text}
    </p>
  );
}

function format(number: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    number,
  );
}
