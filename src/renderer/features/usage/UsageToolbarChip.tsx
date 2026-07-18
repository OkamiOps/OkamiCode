import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { UsageOverviewContract } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";

interface ProviderUsage {
  label: string;
  tone: "claude" | "gpt";
  usedPercent: number | null;
}

const FALLBACK: ProviderUsage[] = [
  { label: "Claude", tone: "claude", usedPercent: null },
  { label: "ChatGPT", tone: "gpt", usedPercent: null },
];

export function UsageToolbarChip() {
  const [overview, setOverview] = useState<UsageOverviewContract | null>(null);

  useEffect(() => {
    if (!window.okami?.invoke) return;
    let active = true;
    void workbenchClient
      .usageOverview()
      .then((value) => {
        if (active && "generatedAt" in value) setOverview(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const providers = overview ? providerUsage(overview) : FALLBACK;

  return (
    <Link
      aria-label="Abrir Uso e limites"
      className="usage-toolbar-chip"
      to="/usage"
    >
      {providers.map((provider) => (
        <span className="usage-toolbar-chip__metric" key={provider.tone}>
          <span className="usage-toolbar-chip__bar" aria-hidden="true">
            <i
              className={`usage-toolbar-chip__fill usage-toolbar-chip__fill--${provider.tone}`}
              style={{ width: `${provider.usedPercent ?? 0}%` }}
            />
          </span>
          <span>
            {provider.label}{" "}
            <strong>
              {provider.usedPercent === null
                ? "—"
                : `${format(provider.usedPercent)}%`}
            </strong>
          </span>
        </span>
      ))}
    </Link>
  );
}

function providerUsage(overview: UsageOverviewContract): ProviderUsage[] {
  return FALLBACK.map((provider) => {
    const match = overview.subscriptions.find((snapshot) =>
      provider.tone === "claude"
        ? snapshot.provider === "claude_max"
        : snapshot.provider === "chatgpt",
    );
    const measured = match?.windows
      .flatMap((window) =>
        window.usedPercent === null ? [] : [window.usedPercent],
      )
      .sort((left, right) => right - left)[0];
    return { ...provider, usedPercent: measured ?? null };
  });
}

function format(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    value,
  );
}
