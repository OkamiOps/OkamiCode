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
import { workbenchClient } from "../../lib/ipc/client";
import { ActivityDashboard } from "./ActivityDashboard";
import { SourceFreshness, SubscriptionTable } from "./SubscriptionTable";

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
  return (
    <section
      className="h-full min-h-0 overflow-y-auto"
      aria-labelledby="usage-heading"
    >
      <header className="flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-[var(--ok-border)] bg-[var(--ok-surface-1)] px-4 py-4 sm:px-6">
        <div>
          <p className="pane-kicker m-0">Controle de consumo honesto</p>
          <h1
            className="mb-0 mt-1 text-xl font-semibold tracking-[-0.03em]"
            id="usage-heading"
          >
            Uso e limites
          </h1>
        </div>
        <Button
          className="border border-[var(--ok-border)] bg-[var(--ok-surface-2)] text-xs text-[var(--ok-text)]"
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

      <div className="grid gap-5 p-4 sm:p-6">
        <section aria-labelledby="subscription-heading">
          <MeasureHeading
            description="Percentuais do provider permanecem separados dos contadores locais."
            id="subscription-heading"
            title="Quota da assinatura"
          />
          <SubscriptionTable subscriptions={overview.subscriptions} />
        </section>

        <section aria-labelledby="context-heading">
          <MeasureHeading
            description="Ocupação da conversa ativa, sem inferir cobrança do provider."
            id="context-heading"
            title="Contexto desta sessão"
          />
          <Card className="border border-[var(--ok-border)] bg-[var(--ok-surface-1)] shadow-none">
            <Card.Content className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <p className="m-0 text-2xl font-semibold tabular-nums tracking-[-0.04em]">
                  {context.usedPercent === null
                    ? "contexto indisponível"
                    : `${format(context.usedPercent)}% usado`}
                </p>
                <p className="mb-0 mt-1 text-[11px] text-[var(--ok-text-muted)]">
                  {context.remainingTokens === null
                    ? "Tokens restantes não informados"
                    : `${format(context.remainingTokens)} tokens restantes`}
                </p>
              </div>
              <Chip
                className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[10px]"
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
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="m-0 text-base font-semibold" id={id}>
          {title}
        </h2>
        <p className="mb-0 mt-1 text-[11px] text-[var(--ok-text-muted)]">
          {description}
        </p>
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
    <form
      className="flex flex-wrap items-end gap-3 rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-1)] p-4"
      onSubmit={submit}
    >
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
