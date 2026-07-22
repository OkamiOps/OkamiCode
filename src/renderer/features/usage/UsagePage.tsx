import { Button, Card, Chip } from "@heroui/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import type { ProviderKind } from "../../../shared/contracts/lane";
import { workbenchClient } from "../../lib/ipc/client";
import { ActivityDashboard } from "./ActivityDashboard";
import {
  SourceFreshness,
  SubscriptionCards,
  SubscriptionTable,
} from "./SubscriptionTable";

export type UsageOverview = Extract<
  IpcResponse<"usage:overview">,
  { generatedAt: string }
>;

interface UsageApi {
  overview(): Promise<UsageOverview>;
  refresh(): Promise<UsageOverview>;
  setAlert(request: IpcRequest<"usage:alertSet">): Promise<unknown>;
}

interface UsagePageProps {
  api?: UsageApi;
  overview?: UsageOverview;
}

const usageApi: UsageApi = {
  overview: async () => requireOverview(await workbenchClient.usageOverview()),
  refresh: async () => requireOverview(await workbenchClient.usageRefresh()),
  setAlert: (request) => workbenchClient.usageAlertSet(request),
};

export function UsagePage({ api = usageApi, overview }: UsagePageProps) {
  if (overview) return <UsageContent overview={overview} />;
  return <ConnectedUsagePage api={api} />;
}

function ConnectedUsagePage({ api }: { api: UsageApi }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { retry: false, staleTime: 60_000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <UsageQuery api={api} />
    </QueryClientProvider>
  );
}

function UsageQuery({ api }: { api: UsageApi }) {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["usage"], queryFn: api.overview });
  const refresh = useMutation({
    mutationFn: api.refresh,
    onSuccess: (next) => queryClient.setQueryData(["usage"], next),
  });
  const alert = useMutation({
    mutationFn: api.setAlert,
    onSuccess: () => overview.refetch(),
  });
  if (overview.isLoading) {
    return <UsageStatus message="Carregando fontes de uso…" />;
  }
  if (!overview.data) {
    return (
      <UsageStatus
        error
        message={`Não foi possível carregar Uso e limites: ${message(overview.error)}`}
      />
    );
  }
  return (
    <UsageContent
      alertError={message(alert.error)}
      isRefreshing={refresh.isPending}
      onAlertSet={(request) => alert.mutateAsync(request)}
      onRefresh={() => refresh.mutate()}
      overview={overview.data}
    />
  );
}

function UsageStatus({
  error = false,
  message: detail,
}: {
  error?: boolean;
  message: string;
}) {
  return (
    <section
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      aria-labelledby="usage-heading"
    >
      <header className="border-b border-[var(--ok-border)] bg-[var(--ok-surface-1)] px-4 py-4 sm:px-6">
        <p className="pane-kicker m-0">Controle de consumo honesto</p>
        <h1
          className="mb-0 mt-1 text-xl font-semibold tracking-[-0.03em]"
          id="usage-heading"
        >
          Uso e limites
        </h1>
      </header>
      <div
        className={`grid place-items-center p-6 text-center text-xs ${error ? "text-[var(--ok-red)]" : "text-[var(--ok-text-muted)]"}`}
        role={error ? "alert" : "status"}
      >
        {detail}
      </div>
    </section>
  );
}

function UsageContent({
  alertError,
  isRefreshing = false,
  onAlertSet,
  onRefresh,
  overview,
}: {
  alertError?: string;
  isRefreshing?: boolean;
  onAlertSet?: (request: IpcRequest<"usage:alertSet">) => Promise<unknown>;
  onRefresh?: () => void;
  overview: UsageOverview;
}) {
  const context = overview.context;
  const [focusedProvider, setFocusedProvider] = useState<ProviderKind>(
    overview.subscriptions[0]?.provider ?? "chatgpt",
  );
  const orderedSubscriptions = [...overview.subscriptions].sort(
    (left, right) =>
      left.provider === focusedProvider
        ? -1
        : right.provider === focusedProvider
          ? 1
          : 0,
  );
  return (
    <section className="usage-page" aria-labelledby="usage-heading">
      <header className="usage-page__header">
        <div>
          <p>Quota, contexto e atividade usam fontes independentes</p>
          <h1 id="usage-heading">Uso e limites</h1>
        </div>
        <Button
          className="usage-refresh"
          isDisabled={!onRefresh || isRefreshing}
          size="sm"
          variant="secondary"
          onPress={onRefresh}
        >
          <RefreshCw
            aria-hidden="true"
            className={isRefreshing ? "animate-spin" : ""}
            size={14}
          />
          {isRefreshing ? "Atualizando…" : "Atualizar fontes"}
        </Button>
      </header>

      <div className="usage-page__content">
        <UsageProviderStrip
          focusedProvider={focusedProvider}
          onFocus={setFocusedProvider}
          subscriptions={overview.subscriptions}
        />
        <section
          className="usage-section"
          aria-labelledby="subscription-heading"
        >
          <MeasureHeading
            description="A barra e o percentual mostram o que ainda resta. Ausência de leitura nunca vira 0%."
            id="subscription-heading"
            title="Quota da assinatura"
          />
          <SubscriptionCards
            selectedProvider={focusedProvider}
            subscriptions={orderedSubscriptions}
          />
          <SubscriptionTable
            activity={overview.activity}
            subscriptions={orderedSubscriptions}
          />
        </section>

        <ModelUsageBoard activity={overview.activity} />

        <section className="usage-section" aria-labelledby="context-heading">
          <MeasureHeading
            description="Ocupação da conversa ativa, sem inferir cobrança do provider."
            id="context-heading"
            title="Contexto desta sessão"
          />
          <Card className="usage-context-card">
            <Card.Content className="usage-context-card__content">
              <div>
                <p className="usage-context-card__value">
                  {context.usedPercent === null
                    ? "contexto indisponível"
                    : `${format(context.usedPercent)}% usado`}
                </p>
                <p className="usage-context-card__note">
                  {context.remainingTokens === null
                    ? "Tokens restantes não informados"
                    : `${format(context.remainingTokens)} tokens restantes`}
                </p>
              </div>
              <Chip
                className="usage-context-card__source"
                size="sm"
                variant="secondary"
              >
                <SourceFreshness snapshot={context} />
              </Chip>
            </Card.Content>
          </Card>
        </section>

        <AlertControls
          error={alertError}
          onSave={onAlertSet}
          overview={overview}
        />
        <ActivityDashboard activity={overview.activity} />
      </div>
    </section>
  );
}

function ModelUsageBoard({
  activity,
}: {
  activity: UsageOverview["activity"];
}) {
  const rows = Object.values(
    activity.reduce<
      Record<
        string,
        {
          provider: ProviderKind;
          model: string;
          input: number;
          cache: number;
          output: number;
          calls: number;
        }
      >
    >((accumulator, bucket) => {
      const key = `${bucket.provider}:${bucket.model}`;
      const row = accumulator[key] ?? {
        provider: bucket.provider,
        model: bucket.model,
        input: 0,
        cache: 0,
        output: 0,
        calls: 0,
      };
      row.input += bucket.inputTokens;
      row.cache += bucket.cachedInputTokens;
      row.output += bucket.outputTokens + bucket.reasoningTokens;
      row.calls += bucket.modelCalls;
      accumulator[key] = row;
      return accumulator;
    }, {}),
  ).sort(
    (left, right) =>
      right.input +
      right.cache +
      right.output -
      (left.input + left.cache + left.output),
  );
  if (rows.length === 0) return null;
  return (
    <section
      className="usage-model-board"
      aria-labelledby="model-usage-heading"
    >
      <MeasureHeading
        description="Telemetria local separada por modelo. Entrada nova, cache e saída nunca são misturados."
        id="model-usage-heading"
        title="Consumo por modelo"
      />
      <div className="usage-model-board__grid">
        {rows.map((row) => (
          <article
            className="usage-model-row"
            data-provider={row.provider}
            key={`${row.provider}:${row.model}`}
          >
            <span className="usage-model-row__provider">
              {usageProviders.find((item) => item.provider === row.provider)
                ?.glyph ?? "AI"}
            </span>
            <div className="usage-model-row__identity">
              <strong>{row.model}</strong>
              <small>
                {usageProviders.find((item) => item.provider === row.provider)
                  ?.label ?? row.provider}{" "}
                · {format(row.calls)} chamadas
              </small>
            </div>
            <TokenMeasure label="Entrada nova" tone="input" value={row.input} />
            <TokenMeasure label="Cache lido" tone="cache" value={row.cache} />
            <TokenMeasure label="Saída" tone="output" value={row.output} />
          </article>
        ))}
      </div>
    </section>
  );
}

function TokenMeasure({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "input" | "cache" | "output";
  value: number;
}) {
  return (
    <div className="usage-model-row__measure" data-tone={tone}>
      <span>{label}</span>
      <strong>{format(value)}</strong>
    </div>
  );
}

const usageProviders: {
  provider: ProviderKind;
  label: string;
  glyph: string;
}[] = [
  { provider: "chatgpt", label: "ChatGPT", glyph: "GP" },
  { provider: "claude_max", label: "Claude", glyph: "CL" },
  { provider: "cursor", label: "Cursor", glyph: "CU" },
  { provider: "antigravity", label: "Antigravity", glyph: "AG" },
  { provider: "grok", label: "Grok", glyph: "GK" },
  { provider: "mimo", label: "MiMo", glyph: "MI" },
  { provider: "minimax", label: "MiniMax", glyph: "MX" },
];

function UsageProviderStrip({
  focusedProvider,
  onFocus,
  subscriptions,
}: {
  focusedProvider: ProviderKind;
  onFocus: (provider: ProviderKind) => void;
  subscriptions: UsageOverview["subscriptions"];
}) {
  return (
    <section
      className="usage-provider-strip"
      aria-labelledby="usage-provider-heading"
    >
      <header>
        <div>
          <h2 id="usage-provider-heading">Providers</h2>
          <p>
            Selecione um provider para colocá-lo em foco. Todos permanecem
            visíveis abaixo.
          </p>
        </div>
        <span>Restante, não consumido</span>
      </header>
      <div className="usage-provider-strip__rail">
        {usageProviders.map((meta) => {
          const snapshot = subscriptions.find(
            (entry) => entry.provider === meta.provider,
          );
          const remaining = snapshot?.windows
            .flatMap((window) =>
              window.remainingPercent === null ? [] : [window.remainingPercent],
            )
            .sort((left, right) => left - right)[0];
          return (
            <button
              aria-pressed={focusedProvider === meta.provider}
              data-provider={meta.provider}
              key={meta.provider}
              onClick={() => onFocus(meta.provider)}
              type="button"
            >
              <span aria-hidden="true">{meta.glyph}</span>
              <strong>{meta.label}</strong>
              <small>
                {remaining === undefined
                  ? "Sem leitura"
                  : `${format(remaining)}% restante`}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MeasureHeading({
  description,
  id,
  title,
}: {
  description: string;
  id: string;
  title: string;
}) {
  return (
    <div className="usage-section-heading">
      <div>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      <ShieldCheck
        aria-hidden="true"
        className="text-[var(--ok-green)]"
        size={17}
      />
    </div>
  );
}

function AlertControls({
  error,
  onSave,
  overview,
}: {
  error?: string;
  onSave?: (request: IpcRequest<"usage:alertSet">) => Promise<unknown>;
  overview: UsageOverview;
}) {
  const [accountRef, setAccountRef] = useState(
    overview.subscriptions[0]?.accountRef ?? "",
  );
  const [remainingPercent, setRemainingPercent] = useState(25);
  const selected = overview.subscriptions.find(
    (subscription) => subscription.accountRef === accountRef,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !onSave) return;
    await onSave({
      accountRef,
      enabled: true,
      provider: selected.provider,
      remainingPercent,
    });
  }
  return (
    <form className="usage-alert-controls" onSubmit={submit}>
      <div className="mr-auto min-w-52">
        <div className="flex items-center gap-2">
          <AlertTriangle
            aria-hidden="true"
            className="text-[var(--ok-yellow)]"
            size={15}
          />
          <h2 className="m-0 text-sm font-semibold">Alertas de quota</h2>
        </div>
        <p className="mb-0 mt-1 text-[10px] text-[var(--ok-text-muted)]">
          Aviso determinístico; nunca troca a lane sozinho.
        </p>
      </div>
      <label className="grid gap-1 text-[10px] text-[var(--ok-text-muted)]">
        Assinatura
        <select
          aria-label="Assinatura do alerta"
          className="h-9 rounded-[var(--ok-radius-sm)] border border-[var(--ok-border)] bg-[var(--ok-bg)] px-2 text-xs text-[var(--ok-text)]"
          value={accountRef}
          onChange={(event) => setAccountRef(event.target.value)}
        >
          {overview.subscriptions.map((subscription) => (
            <option
              key={subscription.accountRef}
              value={subscription.accountRef}
            >
              {subscription.accountLabel}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-[10px] text-[var(--ok-text-muted)]">
        Alertar em
        <input
          aria-label="Percentual restante para alerta"
          className="h-9 w-24 rounded-[var(--ok-radius-sm)] border border-[var(--ok-border)] bg-[var(--ok-bg)] px-2 text-xs tabular-nums text-[var(--ok-text)]"
          max={100}
          min={0}
          type="number"
          value={remainingPercent}
          onChange={(event) => setRemainingPercent(Number(event.target.value))}
        />
      </label>
      <Button
        className="h-9 border border-[var(--ok-border)] bg-[var(--ok-surface-3)] text-xs"
        isDisabled={!onSave || !selected}
        type="submit"
        variant="secondary"
      >
        Salvar alerta
      </Button>
      {error && (
        <p className="w-full text-[10px] text-[var(--ok-red)]" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function requireOverview(
  value: IpcResponse<"usage:overview"> | IpcResponse<"usage:refresh">,
): UsageOverview {
  if ("generatedAt" in value) return value;
  throw new Error("Usage Control Center ainda não está disponível");
}

function format(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
    value,
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : error ? String(error) : "";
}
