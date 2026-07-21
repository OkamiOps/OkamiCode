import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
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

const pricingStorageKey = "okami.dashboard.api-pricing";

export function HomePage() {
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricing, setPricing] = useState(readPricing);
  const snapshot = useQuery({
    queryKey: ["home", "snapshot"],
    queryFn: loadDashboardSnapshot,
    refetchInterval: 60_000,
  });
  const data = snapshot.data;
  const totals = (data?.usage?.activity ?? []).reduce(
    (sum, item) => ({
      input: sum.input + item.inputTokens + item.cachedInputTokens,
      output: sum.output + item.outputTokens + item.reasoningTokens,
      calls: sum.calls + item.modelCalls,
    }),
    { input: 0, output: 0, calls: 0 },
  );
  const estimate =
    pricing.input > 0 || pricing.output > 0
      ? (totals.input / 1_000_000) * pricing.input +
        (totals.output / 1_000_000) * pricing.output
      : null;
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
            label="Simulação API equivalente"
            value={estimate === null ? "Não configurada" : usd(estimate)}
            detail="Estimativa local; não é cobrança da assinatura"
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
          pricing={pricing}
          onClose={() => setPricingOpen(false)}
          onSave={(next) => {
            setPricing(next);
            localStorage.setItem(pricingStorageKey, JSON.stringify(next));
            setPricingOpen(false);
          }}
        />
      )}
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
  pricing,
}: {
  pricing: Pricing;
  onClose: () => void;
  onSave: (pricing: Pricing) => void;
}) {
  const [input, setInput] = useState(String(pricing.input || ""));
  const [output, setOutput] = useState(String(pricing.output || ""));
  return (
    <div className="ok-modal-backdrop" role="presentation">
      <section
        aria-labelledby="pricing-heading"
        aria-modal="true"
        className="home-pricing-dialog"
        role="dialog"
      >
        <p className="pane-kicker">Referência local</p>
        <h2 id="pricing-heading">Simular custo de API</h2>
        <p>
          Informe o preço por 1 milhão de tokens. Isso não altera nem representa
          a cobrança das suas assinaturas.
        </p>
        <div className="home-pricing-dialog__fields">
          <label>
            Entrada (US$)
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => setInput(event.target.value)}
              type="number"
              value={input}
            />
          </label>
          <label>
            Saída (US$)
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => setOutput(event.target.value)}
              type="number"
              value={output}
            />
          </label>
        </div>
        <footer>
          <Button variant="ghost" onPress={onClose}>
            Cancelar
          </Button>
          <Button
            className="home-pricing-dialog__save"
            onPress={() =>
              onSave({
                input: Math.max(0, Number(input) || 0),
                output: Math.max(0, Number(output) || 0),
              })
            }
          >
            Salvar referência
          </Button>
        </footer>
      </section>
    </div>
  );
}

interface Pricing {
  input: number;
  output: number;
}
function readPricing(): Pricing {
  try {
    const value = JSON.parse(
      localStorage.getItem(pricingStorageKey) ?? "null",
    ) as Partial<Pricing> | null;
    return {
      input: Number(value?.input) || 0,
      output: Number(value?.output) || 0,
    };
  } catch {
    return { input: 0, output: 0 };
  }
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
