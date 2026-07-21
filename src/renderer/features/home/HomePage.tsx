import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  Inbox,
  MessageSquareText,
  RefreshCw,
  ServerCog,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import {
  calculateRoi,
  defaultSubscriptionPrices,
  subscriptionDefaults,
  type RoiSummary,
  type SubscriptionPrices,
} from "./roi";

type UsageOverview = IpcResponse<"usage:overview">;
type SystemDoctor = IpcResponse<"system:doctor">;
type InboxAccounts = IpcResponse<"inbox:accounts:list">;
type CalendarSources = IpcResponse<"calendar:sources:list">;
type Tasks = IpcResponse<"task:list">;

interface DashboardSnapshot {
  usage: UsageOverview | null;
  doctor: SystemDoctor | null;
  inbox: InboxAccounts | null;
  calendars: CalendarSources | null;
  tasks: Tasks | null;
}

const subscriptionStorageKey = "okami.dashboard.subscriptions";

export function HomePage() {
  const [pricingOpen, setPricingOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState(readSubscriptions);
  const snapshot = useQuery({
    queryKey: ["home", "snapshot"],
    queryFn: loadDashboardSnapshot,
    refetchInterval: 60_000,
  });
  const data = snapshot.data;
  const pricingCatalog = useQuery({
    queryKey: ["usage", "openrouter-pricing"],
    queryFn: () => workbenchClient.usageOpenRouterPricing(),
    staleTime: 6 * 60 * 60 * 1_000,
    retry: 1,
  });
  const totals = (data?.usage?.activity ?? []).reduce(
    (sum, item) => ({
      input: sum.input + item.inputTokens + item.cachedInputTokens,
      output: sum.output + item.outputTokens + item.reasoningTokens,
      calls: sum.calls + item.modelCalls,
    }),
    { input: 0, output: 0, calls: 0 },
  );
  const roi = calculateRoi(
    data?.usage?.activity ?? [],
    pricingCatalog.data ?? null,
    subscriptions,
  );
  const runtimeClients = data?.doctor?.clients ?? [];
  const readyClients = runtimeClients.filter(
    (client) => client.integrationStatus === "ready",
  ).length;
  const connectedMail = (data?.inbox ?? []).filter(
    (item) => item.account.status === "connected",
  ).length;
  const activeCalendars = (data?.calendars ?? []).filter(
    (source) => source.status === "active",
  ).length;
  const activeTasks = (data?.tasks ?? []).filter(
    (task) => task.kind === "workbench" && task.status === "active",
  );

  return (
    <section className="home-page" aria-labelledby="home-heading">
      <header className="home-hero">
        <div>
          <p className="pane-kicker">Central de operação local</p>
          <h1 id="home-heading">{greeting()}, Marcos.</h1>
          <p className="home-hero__lead">
            O ambiente em uma leitura: consumo, runtimes, comunicação e trabalho
            ativo.
          </p>
        </div>
        <Button
          className="home-refresh"
          isDisabled={snapshot.isFetching}
          size="sm"
          variant="secondary"
          onPress={() => void snapshot.refetch()}
        >
          <RefreshCw
            aria-hidden="true"
            className={snapshot.isFetching ? "animate-spin" : ""}
            size={14}
          />
          {snapshot.isFetching ? "Atualizando" : "Atualizar"}
        </Button>
      </header>

      <div className="home-content">
        <section className="home-pulse" aria-label="Pulso do ambiente">
          <div className="home-pulse__signal">
            <span className="home-pulse__orb">
              <Zap aria-hidden="true" size={18} />
            </span>
            <div>
              <span>Pulso do ambiente</span>
              <strong>{environmentLabel(data)}</strong>
            </div>
          </div>
          <PulseItem
            label="CLIs prontos"
            value={
              data?.doctor ? `${readyClients}/${runtimeClients.length}` : "—"
            }
          />
          <PulseItem
            label="Caixas conectadas"
            value={data?.inbox ? String(connectedMail) : "—"}
          />
          <PulseItem
            label="Agendas ativas"
            value={data?.calendars ? String(activeCalendars) : "—"}
          />
          <PulseItem
            label="Projetos ativos"
            value={data?.tasks ? String(activeTasks.length) : "—"}
          />
        </section>

        <div className="home-metric-grid">
          <MetricCard
            accent="cyan"
            icon={Activity}
            label="Tokens locais observados"
            value={data?.usage ? compact(totals.input + totals.output) : "—"}
            detail={`${compact(totals.calls)} chamadas registradas`}
            href="/usage"
          />
          <MetricCard
            accent="orange"
            icon={CircleDollarSign}
            label="API equivalente · 30 dias"
            value={
              roi.pricedTokens > 0
                ? usdEquivalent(roi.apiEquivalentTotalUsd)
                : "Sem cobertura"
            }
            detail={`${usd(roi.subscriptionTotalUsd)}/mês em assinaturas · ${coverageLabel(roi)}`}
            onClick={() => setPricingOpen(true)}
          />
          <MetricCard
            accent="green"
            icon={Bot}
            label="Runtimes disponíveis"
            value={data?.doctor ? String(readyClients) : "—"}
            detail={
              runtimeClients.length
                ? runtimeClients.map((client) => client.label).join(" · ")
                : "Diagnóstico indisponível"
            }
            href="/models"
          />
          <MetricCard
            accent="violet"
            icon={ServerCog}
            label="Contexto da sessão"
            value={formatContext(data?.usage ?? null)}
            detail="Separado da cota da assinatura"
            href="/usage"
          />
        </div>

        <RoiPanel
          catalogError={pricingCatalog.isError}
          catalogFetchedAt={pricingCatalog.data?.fetchedAt ?? null}
          loading={pricingCatalog.isLoading}
          roi={roi}
          onConfigure={() => setPricingOpen(true)}
        />

        <div className="home-columns">
          <section
            className="home-panel"
            aria-labelledby="integrations-heading"
          >
            <PanelHeader
              eyebrow="Conectividade"
              id="integrations-heading"
              title="Integrações"
              href="/connections"
            />
            <div className="home-status-list">
              <StatusRow
                icon={Inbox}
                label="Email"
                value={mailStatus(data?.inbox ?? null)}
                tone={connectedMail > 0 ? "good" : "warn"}
              />
              <StatusRow
                icon={CalendarDays}
                label="Agenda"
                value={calendarStatus(data?.calendars ?? null)}
                tone={activeCalendars > 0 ? "good" : "warn"}
              />
              <StatusRow
                icon={Bot}
                label="Runtimes locais"
                value={
                  data?.doctor ? `${readyClients} prontos` : "Sem diagnóstico"
                }
                tone={readyClients > 0 ? "good" : "warn"}
              />
            </div>
          </section>

          <section className="home-panel" aria-labelledby="work-heading">
            <PanelHeader
              eyebrow="Em andamento"
              id="work-heading"
              title="Trabalho recente"
              href="/workbench"
            />
            <div className="home-work-list">
              {activeTasks.slice(0, 4).map((task) => (
                <Link key={task.id} to={`/workbench?task=${task.id}`}>
                  <span className="home-work-list__dot" />
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.workspacePath ?? "Workspace ainda não definido"}
                    </small>
                  </span>
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              ))}
              {data?.tasks && activeTasks.length === 0 && (
                <EmptyRow
                  icon={MessageSquareText}
                  text="Nenhum projeto ativo."
                />
              )}
              {!data?.tasks && (
                <EmptyRow
                  icon={TriangleAlert}
                  text="Projetos indisponíveis agora."
                />
              )}
            </div>
          </section>
        </div>
      </div>

      {pricingOpen && (
        <PricingDialog
          subscriptions={subscriptions}
          onClose={() => setPricingOpen(false)}
          onSave={(next) => {
            setSubscriptions(next);
            localStorage.setItem(subscriptionStorageKey, JSON.stringify(next));
            setPricingOpen(false);
          }}
        />
      )}
    </section>
  );
}

function RoiPanel({
  catalogError,
  catalogFetchedAt,
  loading,
  onConfigure,
  roi,
}: {
  catalogError: boolean;
  catalogFetchedAt: string | null;
  loading: boolean;
  onConfigure: () => void;
  roi: RoiSummary;
}) {
  return (
    <section className="home-roi" aria-labelledby="roi-heading">
      <header className="home-roi__header">
        <div>
          <span className="pane-kicker">Retorno das assinaturas</span>
          <h2 id="roi-heading">Assinatura ou API?</h2>
          <p>
            Uso local dos últimos 30 dias comparado ao preço equivalente no
            OpenRouter, incluindo a taxa de compra de créditos de 5,5%.
          </p>
        </div>
        <button onClick={onConfigure} type="button">
          Ajustar mensalidades
        </button>
      </header>
      <div
        className="home-roi__table"
        role="table"
        aria-label="Comparação de custo"
      >
        <div className="home-roi__row home-roi__row--head" role="row">
          <span>Fornecedor</span>
          <span>Assinatura</span>
          <span>API equivalente</span>
          <span>Cobertura</span>
          <span>Leitura</span>
        </div>
        {roi.rows.map((row) => (
          <div className="home-roi__row" key={row.id} role="row">
            <strong>{row.label}</strong>
            <span>{usd(row.subscriptionUsd)}/mês</span>
            <span>
              {row.apiEquivalentUsd === null
                ? "—"
                : usdEquivalent(row.apiEquivalentUsd)}
            </span>
            <span>
              {row.coveragePercent === null
                ? "Sem telemetria"
                : `${row.coveragePercent}%`}
            </span>
            <span
              className={`home-roi__verdict home-roi__verdict--${row.verdict}`}
            >
              {verdictLabel(row.verdict)}
            </span>
          </div>
        ))}
      </div>
      <footer className="home-roi__footer">
        <span>
          {loading
            ? "Atualizando preços públicos…"
            : catalogError
              ? "Preço do OpenRouter indisponível; valores não foram estimados."
              : `Preços atualizados ${relativeTime(catalogFetchedAt)}.`}
        </span>
        <button
          onClick={() =>
            void workbenchClient.systemOpenExternal({
              url: "https://openrouter.ai/models",
            })
          }
          type="button"
        >
          Fonte: OpenRouter <ExternalLink aria-hidden="true" size={12} />
        </button>
      </footer>
    </section>
  );
}

async function loadDashboardSnapshot(): Promise<DashboardSnapshot> {
  const results = await Promise.allSettled([
    workbenchClient.usageOverview(),
    workbenchClient.systemDoctor(),
    workbenchClient.inboxAccountsList(),
    workbenchClient.calendarSourcesList(),
    workbenchClient.taskList(),
  ]);
  const value = <T,>(index: number): T | null =>
    results[index]?.status === "fulfilled" ? (results[index].value as T) : null;
  return {
    usage: value<UsageOverview>(0),
    doctor: value<SystemDoctor>(1),
    inbox: value<InboxAccounts>(2),
    calendars: value<CalendarSources>(3),
    tasks: value<Tasks>(4),
  };
}

function PulseItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="home-pulse__item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricCard({
  accent,
  detail,
  href,
  icon: Icon,
  label,
  onClick,
  value,
}: {
  accent: "cyan" | "orange" | "green" | "violet";
  detail: string;
  href?: string;
  icon: typeof Activity;
  label: string;
  onClick?: () => void;
  value: string;
}) {
  const content = (
    <>
      <span className="home-metric__icon">
        <Icon aria-hidden="true" size={17} />
      </span>
      <span className="home-metric__label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <ArrowRight aria-hidden="true" className="home-metric__arrow" size={14} />
    </>
  );
  return href ? (
    <Link className={`home-metric home-metric--${accent}`} to={href}>
      {content}
    </Link>
  ) : (
    <button
      className={`home-metric home-metric--${accent}`}
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  );
}

function PanelHeader({
  eyebrow,
  href,
  id,
  title,
}: {
  eyebrow: string;
  href: string;
  id: string;
  title: string;
}) {
  return (
    <header className="home-panel__header">
      <div>
        <span>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <Link to={href}>
        Ver tudo <ArrowRight aria-hidden="true" size={13} />
      </Link>
    </header>
  );
}

function StatusRow({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof Inbox;
  label: string;
  tone: "good" | "warn";
  value: string;
}) {
  return (
    <div className="home-status-row">
      <span className="home-status-row__icon">
        <Icon aria-hidden="true" size={15} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{value}</small>
      </span>
      <span
        className={`home-status-row__state home-status-row__state--${tone}`}
      >
        {tone === "good" ? (
          <CheckCircle2 aria-hidden="true" size={13} />
        ) : (
          <TriangleAlert aria-hidden="true" size={13} />
        )}
        {tone === "good" ? "Operacional" : "Atenção"}
      </span>
    </div>
  );
}

function EmptyRow({
  icon: Icon,
  text,
}: {
  icon: typeof MessageSquareText;
  text: string;
}) {
  return (
    <div className="home-empty-row">
      <Icon aria-hidden="true" size={16} />
      <span>{text}</span>
    </div>
  );
}

function PricingDialog({
  onClose,
  onSave,
  subscriptions,
}: {
  subscriptions: SubscriptionPrices;
  onClose: () => void;
  onSave: (subscriptions: SubscriptionPrices) => void;
}) {
  const [draft, setDraft] = useState(subscriptions);
  return (
    <div className="ok-modal-backdrop" role="presentation">
      <section
        aria-labelledby="pricing-heading"
        aria-modal="true"
        className="home-pricing-dialog"
        role="dialog"
      >
        <p className="pane-kicker">Compromisso mensal</p>
        <h2 id="pricing-heading">Mensalidades das assinaturas</h2>
        <p>
          O preço por token vem automaticamente do OpenRouter. Ajuste apenas o
          que você paga por mês em cada assinatura.
        </p>
        <div className="home-pricing-dialog__fields">
          {subscriptionDefaults.map((plan) => (
            <label key={plan.id}>
              {plan.label} (US$/mês)
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [plan.id]: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                type="number"
                value={draft[plan.id]}
              />
            </label>
          ))}
        </div>
        <footer>
          <Button variant="ghost" onPress={onClose}>
            Cancelar
          </Button>
          <Button
            className="home-pricing-dialog__save"
            onPress={() => onSave(draft)}
          >
            Salvar mensalidades
          </Button>
        </footer>
      </section>
    </div>
  );
}

function readSubscriptions(): SubscriptionPrices {
  const fallback = defaultSubscriptionPrices();
  try {
    const value = JSON.parse(
      localStorage.getItem(subscriptionStorageKey) ?? "null",
    ) as Partial<SubscriptionPrices> | null;
    return Object.fromEntries(
      subscriptionDefaults.map((plan) => [
        plan.id,
        Math.max(0, Number(value?.[plan.id] ?? fallback[plan.id]) || 0),
      ]),
    ) as SubscriptionPrices;
  } catch {
    return fallback;
  }
}
function verdictLabel(value: RoiSummary["rows"][number]["verdict"]): string {
  if (value === "subscription") return "Assinatura compensou";
  if (value === "api") return "API seria mais barata";
  return "Dados insuficientes";
}
function coverageLabel(roi: RoiSummary): string {
  return roi.coveragePercent === null
    ? "sem telemetria"
    : `${roi.coveragePercent}% precificado`;
}
function relativeTime(value: string | null): string {
  if (!value) return "agora";
  return new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }).format(
    -Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000)),
    "minute",
  );
}
function compact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
function usd(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
function usdEquivalent(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}
function environmentLabel(data?: DashboardSnapshot): string {
  if (!data) return "Lendo os serviços…";
  if (!data.doctor || !data.inbox || !data.calendars || !data.tasks) {
    return "Dados parciais";
  }
  const degraded =
    (data.doctor?.clients ?? []).some(
      (item) => item.integrationStatus !== "ready",
    ) ||
    (data.inbox ?? []).some((item) =>
      ["degraded", "auth_required", "unavailable"].includes(
        item.account.status,
      ),
    );
  return degraded ? "Operacional com atenção" : "Tudo operacional";
}
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
function formatContext(usage: UsageOverview | null): string {
  const value = usage?.context.usedPercent;
  return value == null ? "Indisponível" : `${Math.round(value)}% usado`;
}
function mailStatus(accounts: InboxAccounts | null): string {
  if (!accounts) return "Fonte indisponível";
  return accounts.length === 0
    ? "Nenhuma caixa conectada"
    : `${accounts.filter((item) => item.account.status === "connected").length} de ${accounts.length} caixas conectadas`;
}
function calendarStatus(sources: CalendarSources | null): string {
  if (!sources) return "Fonte indisponível";
  return sources.length === 0
    ? "Nenhuma agenda conectada"
    : `${sources.filter((item) => item.status === "active").length} de ${sources.length} agendas ativas`;
}
