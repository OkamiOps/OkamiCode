import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  UsageOverviewContract,
  UsageSnapshotContract,
} from "../../../shared/contracts/ipc";
import type { ProviderKind } from "../../../shared/contracts/lane";
import { workbenchClient } from "../../lib/ipc/client";

interface UsagePopoverProps {
  activeProvider: ProviderKind | null;
}

interface ProviderMeta {
  glyph: string;
  shortLabel: string;
}

const PROVIDERS: Record<ProviderKind, ProviderMeta> = {
  antigravity: { glyph: "AG", shortLabel: "Antigravity" },
  chatgpt: { glyph: "GP", shortLabel: "ChatGPT" },
  claude_max: { glyph: "CL", shortLabel: "Claude" },
  cursor: { glyph: "CU", shortLabel: "Cursor" },
  grok: { glyph: "GK", shortLabel: "Grok" },
  minimax: { glyph: "MX", shortLabel: "MiniMax" },
  mimo: { glyph: "MI", shortLabel: "MiMo" },
};

function tone(used: number | null): "ok" | "warn" | "high" | "unknown" {
  if (used === null) return "unknown";
  if (used >= 85) return "high";
  if (used >= 60) return "warn";
  return "ok";
}

function countdown(resetsAt: string | null): string {
  if (!resetsAt) return "reset não informado";
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return "reset não informado";
  const minutes = Math.round((target - Date.now()) / 60_000);
  if (minutes <= 0) return "reiniciando";
  if (minutes < 60) return `reinicia em ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `reinicia em ${hours} h ${minutes % 60} min`;
  return `reinicia em ${Math.round(hours / 24)} d`;
}

export function summarizeProviderUsage(
  subscriptions: UsageSnapshotContract[],
  provider: ProviderKind | null,
) {
  if (!provider) return null;
  const snapshot = subscriptions.find((entry) => entry.provider === provider);
  if (!snapshot) return null;
  const restrictive = snapshot.windows
    .filter((window) => window.usedPercent !== null)
    .sort(
      (left, right) => (right.usedPercent ?? 0) - (left.usedPercent ?? 0),
    )[0];
  return {
    remainingPercent: restrictive?.remainingPercent ?? null,
    snapshot,
    usedPercent: restrictive?.usedPercent ?? null,
    window: restrictive ?? null,
  };
}

export function UsagePopover({ activeProvider }: UsagePopoverProps) {
  const [open, setOpen] = useState(false);
  const [inspection, setInspection] = useState<{
    basis: ProviderKind | null;
    provider: ProviderKind;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const overview = useQuery({
    queryKey: ["usage", "overview"],
    queryFn: () => workbenchClient.usageOverview(),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const data =
    overview.data && "generatedAt" in overview.data
      ? (overview.data as UsageOverviewContract)
      : undefined;
  const subscriptions = data?.subscriptions ?? [];
  const inspectedProvider =
    inspection?.basis === activeProvider ? inspection.provider : null;
  const focusedProvider = inspectedProvider ?? activeProvider;
  const focused = summarizeProviderUsage(subscriptions, focusedProvider);
  const trigger = summarizeProviderUsage(subscriptions, activeProvider);
  const triggerMeta = activeProvider ? PROVIDERS[activeProvider] : null;

  return (
    <div className="usage-pop" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label={
          trigger
            ? `Uso e limites · ${trigger.snapshot.accountLabel} · ${remainingLabel(trigger.remainingPercent)}`
            : "Uso e limites · nenhum provider ativo"
        }
        className="usage-pop__trigger"
        data-provider={activeProvider ?? "none"}
        data-tone={tone(trigger?.usedPercent ?? null)}
        onClick={() => {
          setInspection(null);
          setOpen((value) => !value);
        }}
        type="button"
      >
        {triggerMeta && (
          <span aria-hidden="true" className="usage-pop__trigger-glyph">
            {triggerMeta.glyph}
          </span>
        )}
        <span className="usage-pop__trigger-provider">
          {triggerMeta?.shortLabel ?? "Quota"}
        </span>
        <span aria-hidden="true" className="usage-pop__bar">
          <i style={{ width: `${trigger?.remainingPercent ?? 0}%` }} />
        </span>
        <strong>
          {trigger?.remainingPercent === null || !trigger
            ? "—"
            : `${Math.round(trigger.remainingPercent)}% livre`}
        </strong>
      </button>
      {open && (
        <div className="usage-pop__menu">
          <header className="usage-pop__header">
            <div>
              <strong>Quota da lane ativa</strong>
              <span>O provider em uso aparece primeiro.</span>
            </div>
            <button
              aria-label="Atualizar quotas"
              disabled={overview.isFetching}
              onClick={() => void overview.refetch()}
              type="button"
            >
              <RotateCw aria-hidden="true" size={14} />
            </button>
          </header>

          {focused ? (
            <ProviderFocus summary={focused} />
          ) : (
            <div className="usage-pop__no-provider">
              <strong>Nenhum provider ativo</strong>
              <span>
                Escolha um modelo no composer para acompanhar a quota.
              </span>
            </div>
          )}

          <div className="usage-pop__switcher">
            <span>Ver outra assinatura</span>
            <div className="usage-pop__provider-grid">
              {subscriptions.map((snapshot) => {
                const summary = summarizeProviderUsage(
                  subscriptions,
                  snapshot.provider,
                );
                const meta = PROVIDERS[snapshot.provider];
                const selected = snapshot.provider === focusedProvider;
                return (
                  <button
                    aria-label={`Ver quota de ${snapshot.accountLabel}`}
                    aria-pressed={selected}
                    className="usage-pop__provider"
                    data-provider={snapshot.provider}
                    key={snapshot.accountRef}
                    onClick={() =>
                      setInspection({
                        basis: activeProvider,
                        provider: snapshot.provider,
                      })
                    }
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="usage-pop__provider-glyph"
                    >
                      {meta.glyph}
                    </span>
                    <span>{meta.shortLabel}</span>
                    <strong>
                      {remainingShort(summary?.remainingPercent ?? null)}
                    </strong>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            className="usage-pop__full"
            onClick={() => {
              setOpen(false);
              navigate("/usage");
            }}
            type="button"
          >
            Abrir painel completo
            <ArrowUpRight aria-hidden="true" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function ProviderFocus({
  summary,
}: {
  summary: NonNullable<ReturnType<typeof summarizeProviderUsage>>;
}) {
  const { snapshot } = summary;
  const meta = PROVIDERS[snapshot.provider];
  const currentTone = tone(summary.usedPercent);
  return (
    <section
      aria-label={`Quota de ${snapshot.accountLabel}`}
      className="usage-pop__focus"
      data-provider={snapshot.provider}
      data-tone={currentTone}
    >
      <div className="usage-pop__focus-heading">
        <span aria-hidden="true" className="usage-pop__focus-glyph">
          {meta.glyph}
        </span>
        <div>
          <strong>{snapshot.accountLabel}</strong>
          <span>{snapshot.plan ?? "Plano não informado"}</span>
        </div>
        <span className="usage-pop__health">
          {healthLabel(summary.usedPercent)}
        </span>
      </div>
      <div className="usage-pop__headline">
        <strong>{remainingLabel(summary.remainingPercent)}</strong>
        <span>na janela mais restritiva</span>
      </div>
      <span className="usage-pop__focus-track" data-tone={currentTone}>
        <i style={{ width: `${summary.remainingPercent ?? 0}%` }} />
      </span>
      {snapshot.windows.length > 0 ? (
        <div className="usage-pop__windows">
          {snapshot.windows.map((window) => (
            <div className="usage-pop__window" key={window.label}>
              <div>
                <strong>{window.label}</strong>
                <span>{countdown(window.resetsAt)}</span>
              </div>
              <span
                className="usage-pop__window-track"
                data-tone={tone(window.usedPercent)}
              >
                <i style={{ width: `${window.remainingPercent ?? 0}%` }} />
              </span>
              <strong>{remainingShort(window.remainingPercent)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="usage-pop__empty">
          {snapshot.error ?? "Sem dados de quota para este provider."}
        </p>
      )}
    </section>
  );
}

function remainingLabel(value: number | null): string {
  return value === null
    ? "Quota indisponível"
    : `${Math.round(value)}% restante`;
}

function remainingShort(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function healthLabel(used: number | null): string {
  const currentTone = tone(used);
  if (currentTone === "high") return "Crítica";
  if (currentTone === "warn") return "Atenção";
  if (currentTone === "unknown") return "Sem leitura";
  return "Saudável";
}
