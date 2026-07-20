import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UsageOverviewContract } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";

function tone(used: number | null): "ok" | "warn" | "high" {
  if (used === null) return "ok";
  if (used >= 85) return "high";
  if (used >= 60) return "warn";
  return "ok";
}

function countdown(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const target = Date.parse(resetsAt);
  if (Number.isNaN(target)) return "";
  const minutes = Math.round((target - Date.now()) / 60_000);
  if (minutes <= 0) return "reiniciando";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.round(hours / 24)} d`;
}

// Quota at a glance without leaving the conversation, the way Claude and
// Codex surface it; the full page stays one click away.
export function UsagePopover() {
  const [open, setOpen] = useState(false);
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
  const worst = (data?.subscriptions ?? []).flatMap((snapshot) =>
    snapshot.windows.map((window) => ({ snapshot, window })),
  );
  const highest = worst
    .filter((entry) => entry.window.usedPercent !== null)
    .sort(
      (left, right) =>
        (right.window.usedPercent ?? 0) - (left.window.usedPercent ?? 0),
    )[0];

  return (
    <div className="usage-pop" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="Uso e limites"
        className="usage-pop__trigger"
        data-tone={tone(highest?.window.usedPercent ?? null)}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden="true" className="usage-pop__bar">
          <i style={{ width: `${highest?.window.usedPercent ?? 0}%` }} />
        </span>
        {highest ? `${Math.round(highest.window.usedPercent ?? 0)}%` : "uso"}
      </button>
      {open && (
        <div className="usage-pop__menu">
          <header>
            <strong>Uso e limites</strong>
            <button
              aria-label="Atualizar"
              disabled={overview.isFetching}
              onClick={() => void overview.refetch()}
              type="button"
            >
              <RotateCw aria-hidden="true" size={12} />
            </button>
          </header>
          {(data?.subscriptions ?? []).map((snapshot) => (
            <section key={snapshot.accountRef}>
              <div className="usage-pop__account">
                {snapshot.accountLabel}
                {snapshot.plan && <small>{snapshot.plan}</small>}
              </div>
              {snapshot.windows.length === 0 && (
                <p className="usage-pop__empty">
                  {snapshot.error ?? "sem dados de quota"}
                </p>
              )}
              {snapshot.windows.map((window) => (
                <div className="usage-pop__row" key={window.label}>
                  <span className="usage-pop__label">{window.label}</span>
                  <span
                    className="usage-pop__track"
                    data-tone={tone(window.usedPercent)}
                  >
                    <i style={{ width: `${window.usedPercent ?? 0}%` }} />
                  </span>
                  <strong>
                    {window.usedPercent === null
                      ? "—"
                      : `${Math.round(window.usedPercent)}%`}
                  </strong>
                  <small>{countdown(window.resetsAt)}</small>
                </div>
              ))}
            </section>
          ))}
          <button
            className="usage-pop__full"
            onClick={() => {
              setOpen(false);
              navigate("/usage");
            }}
            type="button"
          >
            Ver detalhes e atividade
            <ArrowUpRight aria-hidden="true" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
