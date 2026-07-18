import { Button, Chip, Skeleton, Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronRight,
  Clock3,
  FolderCode,
  Gauge,
  GitBranch,
  Route,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { WorkbenchLane } from "./api";
import { UsageQuickPopover } from "../usage/UsageQuickPopover";
import { workbenchClient } from "../../lib/ipc/client";

interface LaneSelectorProps {
  error: Error | null;
  isLoading: boolean;
  isOpening: boolean;
  lanes: WorkbenchLane[];
  onCollapse: () => void;
  onOpen: (laneId: string) => void;
  selectedLane: WorkbenchLane | null;
}

export function laneDisplayName(lane: WorkbenchLane): string {
  return lane.providerAccountLabel === "ChatGPT" ||
    /^gpt|^o[134]/i.test(lane.model)
    ? "Codex"
    : "Claude";
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
  return (
    <aside
      aria-label="Detalhes da lane"
      className="details-panel h-full min-h-0"
    >
      <header className="pane-header details-panel__header">
        <div>
          <p className="pane-kicker">Sessão</p>
          <h2>Lanes</h2>
        </div>
        <Tooltip.Root closeDelay={0} delay={300}>
          <Button
            aria-label="Recolher painel de detalhes"
            className="icon-button"
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="grid gap-2" aria-label="Carregando lanes">
            <Skeleton className="h-20 rounded-[var(--ok-radius-md)]" />
            <Skeleton className="h-20 rounded-[var(--ok-radius-md)]" />
          </div>
        ) : error ? (
          <p className="text-xs text-[var(--ok-red)]" role="alert">
            Não foi possível carregar as lanes: {error.message}
          </p>
        ) : lanes.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--ok-text-muted)]">
            Nenhuma lane vinculada à tarefa.
          </p>
        ) : (
          <div className="grid gap-2" aria-label="Lanes da tarefa">
            {lanes.map((lane) => {
              const name = laneDisplayName(lane);
              const isSelected = lane.laneId === selectedLane?.laneId;
              const Icon = name === "Codex" ? Bot : Sparkles;
              return (
                <div
                  className="rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-2)] p-2.5"
                  data-selected={isSelected}
                  key={lane.laneId}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      aria-hidden="true"
                      className="text-[var(--ok-orange)]"
                      size={16}
                    />
                    <strong className="min-w-0 flex-1 truncate text-xs">
                      {name}
                    </strong>
                    <Chip
                      className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[10px] text-[var(--ok-cyan)]"
                      size="sm"
                      variant="secondary"
                    >
                      {lane.routeKind}
                    </Chip>
                  </div>
                  <p className="mt-1.5 truncate text-[11px] text-[var(--ok-text-muted)]">
                    {lane.model} · {lane.displayQuotaAccount}
                  </p>
                  {!isSelected && (
                    <Button
                      className="mt-2 h-7 w-full border border-[var(--ok-border)] bg-[var(--ok-surface-3)] text-[11px] text-[var(--ok-text)]"
                      isDisabled={isOpening}
                      size="sm"
                      variant="secondary"
                      onPress={() => onOpen(lane.laneId)}
                    >
                      Mudar para {name}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selectedLane && (
          <dl className="details-list mt-4">
            <div>
              <dt>Harness</dt>
              <dd className="details-inline-value">
                <Route aria-hidden="true" size={13} />
                {harnessLabel(selectedLane)}
              </dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{selectedLane.providerAccountLabel}</dd>
            </div>
            <div>
              <dt>Modelo</dt>
              <dd>{selectedLane.model}</dd>
            </div>
            <div>
              <dt>Assinatura</dt>
              <dd className="details-inline-value justify-between">
                <span className="details-inline-value min-w-0">
                  <Gauge aria-hidden="true" size={13} />
                  {selectedLane.displayQuotaAccount}
                </span>
                <UsageQuickPopover overview={usageOverview} />
              </dd>
            </div>
            <div>
              <dt>Permissões</dt>
              <dd className="details-inline-value">
                <ShieldCheck aria-hidden="true" size={13} />
                {value(selectedLane.permissionMode)}
              </dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd className="details-inline-value">
                <FolderCode aria-hidden="true" size={13} />
                {value(selectedLane.workspacePath)}
              </dd>
            </div>
            <div>
              <dt>Sessão</dt>
              <dd>{value(selectedLane.nativeSessionIdPrefix)}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd className="details-inline-value">
                <Clock3 aria-hidden="true" size={13} />
                {selectedLane.status} · {selectedLane.temperature}
              </dd>
            </div>
          </dl>
        )}
      </div>
      <footer className="details-panel__footer">
        <GitBranch aria-hidden="true" size={14} />
        <span>{selectedLane?.workspacePath ?? "Git aguardando workspace"}</span>
      </footer>
    </aside>
  );
}
