import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Cpu,
  ExternalLink,
  Inbox,
  MessageSquareText,
  RefreshCw,
  ServerCog,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Fragment, useState } from "react";
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
    data?.usage?.generatedAt ? new Date(data.usage.generatedAt) : new Date(),
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
            label="API consumida · período"
            value={
              roi.pricedTokens > 0
                ? usdEquivalent(roi.observedEquivalentTotalUsd)
                : "Sem cobertura"
            }
            detail={`${dayCount(roi.observedDays)} observados · projeção ${usdEquivalent(roi.apiEquivalentTotalUsd)}/mês`}
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

        <RuntimeFleet doctor={data?.doctor ?? null} />

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

function RuntimeFleet({ doctor }: { doctor: SystemDoctor | null }) {
  const runtimes = doctor?.clients ?? [];
  return (
    <section
      className="home-runtime-fleet"
      aria-labelledby="runtime-fleet-heading"
    >
      <header className="home-runtime-fleet__header">
        <div>
          <span className="pane-kicker">Capacidade local detectada</span>
          <h2 id="runtime-fleet-heading">Runtimes e integrações</h2>
        </div>
        <Link to="/models">
          Explorar modelos <ArrowRight aria-hidden="true" size={13} />
        </Link>
      </header>
      {runtimes.length ? (
        <div className="home-runtime-fleet__grid">
          {runtimes.map((client) => {
            const health = doctor?.runtimes.find(
              (entry) => entry.runtime === client.client,
            );
            return (
              <article
                className="home-runtime"
                data-provider={client.client}
                key={client.client}
              >
                <span className="home-runtime__glyph" aria-hidden="true">
                  {runtimeGlyph(client.client)}
                </span>
                <span className="home-runtime__identity">
                  <strong>{client.label}</strong>
                  <small>{client.version ?? "versão indisponível"}</small>
                </span>
                <span
                  className="home-runtime__state"
                  data-status={client.integrationStatus}
                >
                  {client.integrationStatus === "ready" ? (
                    <CheckCircle2 aria-hidden="true" size={12} />
                  ) : (
                    <TriangleAlert aria-hidden="true" size={12} />
                  )}
                  {runtimeStatus(client.integrationStatus)}
                </span>
                <span className="home-runtime__detail">
                  <Cpu aria-hidden="true" size={12} />
                  {health?.status === "ready"
                    ? "execução saudável"
                    : health?.status === "degraded"
                      ? "execução degradada"
                      : health?.status === "unavailable"
                        ? "runtime indisponível"
                        : "saúde não informada"}
                </span>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="home-runtime-fleet__empty">
          {doctor
            ? "Nenhum CLI foi detectado nesta máquina."
            : "Diagnóstico dos CLIs indisponível. Atualize para tentar novamente."}
        </p>
      )}
    </section>
  );
}

function runtimeGlyph(runtime: string): string {
  return (
    (
      {
        claude: "CL",
        codex: "GP",
        cursor: "CU",
        agy: "AG",
        grok: "GK",
        mimo: "MI",
        minimax: "MX",
      } as Record<string, string>
    )[runtime] ?? "AI"
  );
}

function runtimeStatus(
  status: SystemDoctor["clients"][number]["integrationStatus"],
): string {
  if (status === "ready") return "Pronto";
  if (status === "needs_adapter") return "Adapter pendente";
  if (status === "update_required") return "Atualização necessária";
  return "Não encontrado";
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
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(),
  );

  function toggleProvider(providerId: string) {
    setExpandedProviders((current) => {
      const next = new Set(current);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  }

  return (
    <section className="home-roi" aria-labelledby="roi-heading">
      <header className="home-roi__header">
        <div>
          <span className="pane-kicker">Retorno das assinaturas</span>
          <h2 id="roi-heading">Assinatura ou API?</h2>
          <p>
            {roi.observedTokens > 0 ? (
              <>
                <strong>
                  {usdEquivalent(roi.observedEquivalentTotalUsd)} consumidos em{" "}
                  {dayCount(roi.observedDays)}
                </strong>
                <span aria-hidden="true"> → </span>
                {usdEquivalent(roi.apiEquivalentTotalUsd)}/mês no ritmo atual.
                Assinaturas: {usd(roi.subscriptionTotalUsd)}/mês. Mínimo de 7
                dias antes de recomendar cancelamento; taxa de créditos de 5,5%
                incluída.
              </>
            ) : (
              "A comparação começa quando houver telemetria de tokens com preço correspondente no OpenRouter."
            )}
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
          <span>Provider / modelo</span>
          <span>Assinatura</span>
          <span>Entrada nova</span>
          <span>Cache lido</span>
          <span>Saída</span>
          <span>API consumida</span>
          <span>Decisão</span>
        </div>
        {roi.rows.map((row) => {
          const expanded = expandedProviders.has(row.id);
          const detailsId = `roi-models-${row.id}`;
          return (
            <Fragment key={row.id}>
              <div
                className="home-roi__row home-roi__row--provider"
                data-provider={row.id}
                role="row"
              >
                <button
                  aria-controls={detailsId}
                  aria-expanded={expanded}
                  className="home-roi__provider-toggle"
                  disabled={row.models.length === 0}
                  onClick={() => toggleProvider(row.id)}
                  type="button"
                >
                  <ChevronDown aria-hidden="true" size={14} />
                  <span>
                    <strong>{row.label}</strong>
                    <small>
                      {row.models.length === 0
                        ? "Sem atividade por modelo"
                        : `${row.models.length} ${row.models.length === 1 ? "modelo" : "modelos"}`}
                    </small>
                  </span>
                </button>
                <span>{usd(row.subscriptionUsd)}/mês</span>
                <span>
                  {row.observedTokens ? compact(row.inputTokens) : "—"}
                </span>
                <span>
                  {row.observedTokens ? compact(row.cachedInputTokens) : "—"}
                </span>
                <span>
                  {row.observedTokens ? compact(row.outputTokens) : "—"}
                </span>
                <span>
                  {row.observedEquivalentUsd === null
                    ? "—"
                    : `${row.id === "antigravity" ? "≈ " : ""}${usdEquivalent(row.observedEquivalentUsd)}`}
                </span>
                <span
                  className={`home-roi__verdict home-roi__verdict--${row.verdict}`}
                >
                  {roiDecisionLabel(row)}
                </span>
              </div>
              {expanded && row.models.length > 0 && (
                <div
                  className="home-roi__model-group"
                  id={detailsId}
                  role="rowgroup"
                >
                  {row.models.map((model) => (
                    <div
                      className="home-roi__row home-roi__row--model"
                      data-provider={row.id}
                      key={`${row.id}:${model.activityModel}`}
                      role="row"
                    >
                      <span>
                        <strong>{model.activityModel}</strong>
                        <small>
                          {model.pricingModel ?? "sem de-para de preço"}
                        </small>
                      </span>
                      <span className="home-roi__unit-price">preço por 1M</span>
                      <span>
                        {compact(model.inputTokens)}
                        <small>{moneyPerMillion(model.promptPerMillion)}</small>
                      </span>
                      <span>
                        {compact(model.cachedInputTokens)}
                        <small>
                          {moneyPerMillion(model.cacheReadPerMillion)}
                        </small>
                      </span>
                      <span>
                        {compact(model.outputTokens + model.reasoningTokens)}
                        <small>
                          {moneyPerMillion(model.completionPerMillion)}
                        </small>
                      </span>
                      <span>
                        {model.costUsd === null
                          ? "—"
                          : usdEquivalent(model.costUsd)}
                      </span>
                      <span className="home-roi__formula">
                        observado · antes da taxa
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <footer className="home-roi__footer">
        <div>
          <span>
            {loading
              ? "Atualizando preços públicos…"
              : catalogError
                ? "Preço do OpenRouter indisponível; valores não foram estimados."
                : `Preços atualizados ${relativeTime(catalogFetchedAt)}.`}
          </span>
          <small>
            Preços por faixa de contexto podem subestimar a API até o uso ser
            preservado por chamada.
          </small>
        </div>
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

function moneyPerMillion(value: number | null): string {
  return value === null ? "sem preço" : `${usdEquivalent(value)} / 1M`;
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
function roiDecisionLabel(row: RoiSummary["rows"][number]): string {
  if (row.coveragePercent === null) return "Sem telemetria";
  if (row.observedDays < 7) {
    return `${row.observedDays}/7 dias · amostra curta`;
  }
  if (row.coveragePercent < 80 || row.apiEquivalentUsd === null) {
    return `${row.coveragePercent}% · de-para incompleto`;
  }
  const difference = Math.abs(row.subscriptionUsd - row.apiEquivalentUsd);
  return row.verdict === "subscription"
    ? `Assinatura economiza ${usdEquivalent(difference)}/mês`
    : `API economizaria ${usdEquivalent(difference)}/mês`;
}
function dayCount(value: number): string {
  return `${value} ${value === 1 ? "dia" : "dias"}`;
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
