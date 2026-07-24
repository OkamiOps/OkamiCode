import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Blocks,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Save,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { ProviderAuthTerminal } from "./ProviderAuthTerminal";

type CliCapability = IpcResponse<"system:doctor">["clients"][number];
type RuntimeHealth = IpcResponse<"system:doctor">["runtimes"][number];
type ProviderId =
  | "claude"
  | "codex"
  | "cursor"
  | "agy"
  | "grok"
  | "mimo"
  | "minimax"
  | "opencode";

interface ProviderDefinition {
  id: ProviderId;
  label: string;
  shortLabel: string;
  family: "subscription" | "token_plan" | "orchestrator";
  description: string;
  ownership: string;
  auth: "device" | "token_plan" | "interactive";
}

const PROVIDERS: ProviderDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    shortLabel: "CL",
    family: "subscription",
    description: "Assinatura Claude Max ou Pro pela autenticação oficial.",
    ownership: "Único CLI externo necessário",
    auth: "interactive",
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    shortLabel: "CX",
    family: "subscription",
    description: "Assinatura ChatGPT por OAuth e device connection.",
    ownership: "Motor incluído no OkamiCode",
    auth: "device",
  },
  {
    id: "cursor",
    label: "Cursor",
    shortLabel: "CU",
    family: "subscription",
    description: "Sua assinatura Cursor, sem API key pay-as-you-go.",
    ownership: "Motor incluído no OkamiCode",
    auth: "interactive",
  },
  {
    id: "agy",
    label: "Antigravity",
    shortLabel: "AG",
    family: "subscription",
    description: "Conta Antigravity reaproveitada pelo companion local.",
    ownership: "Motor incluído no OkamiCode",
    auth: "interactive",
  },
  {
    id: "grok",
    label: "Grok",
    shortLabel: "GK",
    family: "subscription",
    description: "Assinatura SuperGrok por OAuth e device connection.",
    ownership: "Motor incluído no OkamiCode",
    auth: "device",
  },
  {
    id: "mimo",
    label: "MiMo",
    shortLabel: "MI",
    family: "token_plan",
    description: "Token Plan fixo da Xiaomi, nunca uma chave comum de API.",
    ownership: "Conexão HTTP do OkamiCode",
    auth: "token_plan",
  },
  {
    id: "minimax",
    label: "MiniMax",
    shortLabel: "MM",
    family: "token_plan",
    description: "Token Plan Coding da MiniMax, sem fallback de cobrança.",
    ownership: "Conexão HTTP do OkamiCode",
    auth: "token_plan",
  },
  {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "OC",
    family: "orchestrator",
    description: "Providers adicionais isolados atrás do adapter ACP.",
    ownership: "Motor incluído no OkamiCode",
    auth: "interactive",
  },
];

const INTEGRATION_LABELS = {
  ready: "Motor pronto",
  needs_adapter: "Integração incompleta",
  update_required: "Atualização necessária",
  unavailable: "Motor indisponível",
} as const;

function statusTone(client: CliCapability): "ready" | "warning" | "offline" {
  if (client.integrationStatus === "ready") return "ready";
  if (client.integrationStatus === "unavailable") return "offline";
  return "warning";
}

function runtimeFor(
  runtimes: RuntimeHealth[],
  provider: ProviderId,
): RuntimeHealth | undefined {
  return runtimes.find((runtime) => runtime.runtime === provider);
}

function providerStatus(
  provider: ProviderDefinition,
  runtimes: RuntimeHealth[],
  tokenPlans: IpcResponse<"providerAuth:list">,
  connections: IpcResponse<"providerAuth:status">,
): { tone: "ready" | "attention" | "offline"; label: string } {
  const connection = connections.find(
    (entry) => entry.provider === provider.id,
  );
  if (connection?.status === "connected") {
    return {
      tone: "ready",
      label: connection.accountLabel
        ? `Conectado · ${connection.accountLabel}`
        : "Conectado",
    };
  }
  if (connection?.status === "not_connected") {
    return {
      tone: "attention",
      label:
        provider.family === "token_plan"
          ? "Configurar plano"
          : "Conectar conta",
    };
  }
  if (connection?.status === "unavailable") {
    return { tone: "offline", label: "Indisponível" };
  }
  if (connection?.status === "unknown") {
    return { tone: "attention", label: "Verificar conta" };
  }
  if (provider.family === "token_plan") {
    const configured = tokenPlans.find(
      (entry) => entry.provider === provider.id,
    )?.configured;
    return configured
      ? { tone: "ready", label: "Conectado" }
      : { tone: "attention", label: "Configurar plano" };
  }
  const runtime = runtimeFor(runtimes, provider.id);
  if (!runtime || runtime.status === "unavailable") {
    return { tone: "offline", label: "Indisponível" };
  }
  if (runtime.status === "degraded") {
    return { tone: "attention", label: "Revisar integração" };
  }
  return { tone: "ready", label: "Pronto para autenticar" };
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderId>("minimax");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [inspectedClient, setInspectedClient] = useState<CliCapability | null>(
    null,
  );
  const [interactiveProvider, setInteractiveProvider] = useState<
    "claude" | "cursor" | "agy" | "opencode" | null
  >(null);
  const [tokenPlanDrafts, setTokenPlanDrafts] = useState({
    mimoToken: "",
    mimoBaseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
    minimaxToken: "",
  });
  const [deviceChallenge, setDeviceChallenge] = useState<
    IpcResponse<"providerAuth:startDevice"> | undefined
  >();

  const settings = useQuery({
    queryKey: ["eco", "settings"],
    queryFn: () => workbenchClient.ecoSettings(),
    enabled: diagnosticsOpen,
  });
  const doctor = useQuery({
    queryKey: ["system", "doctor"],
    queryFn: () => workbenchClient.systemDoctor(),
  });
  const providerAuth = useQuery({
    queryKey: ["provider-auth"],
    queryFn: () => workbenchClient.providerAuthList(),
  });
  const providerConnections = useQuery({
    queryKey: ["provider-connections"],
    queryFn: () => workbenchClient.providerAuthStatus(),
    refetchInterval: interactiveProvider ? 3_000 : false,
  });
  const saveTokenPlan = useMutation({
    mutationFn: workbenchClient.providerAuthSetTokenPlan,
    onSuccess: async (status) => {
      setTokenPlanDrafts((current) => ({
        ...current,
        ...(status.provider === "mimo"
          ? { mimoToken: "" }
          : { minimaxToken: "" }),
      }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["provider-auth"] }),
        queryClient.invalidateQueries({ queryKey: ["provider-connections"] }),
        queryClient.invalidateQueries({ queryKey: ["system", "doctor"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
      ]);
    },
  });
  const deleteTokenPlan = useMutation({
    mutationFn: workbenchClient.providerAuthDeleteTokenPlan,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["provider-auth"] }),
        queryClient.invalidateQueries({ queryKey: ["provider-connections"] }),
        queryClient.invalidateQueries({ queryKey: ["system", "doctor"] }),
        queryClient.invalidateQueries({ queryKey: ["models"] }),
      ]);
    },
  });
  const startDeviceAuth = useMutation({
    mutationFn: workbenchClient.providerAuthStartDevice,
    onSuccess: setDeviceChallenge,
  });

  const clients = doctor.data?.clients ?? [];
  const runtimes = useMemo(
    () => doctor.data?.runtimes ?? [],
    [doctor.data?.runtimes],
  );
  const tokenPlans = useMemo(
    () => providerAuth.data ?? [],
    [providerAuth.data],
  );
  const connections = useMemo(
    () => providerConnections.data ?? [],
    [providerConnections.data],
  );
  const provider = PROVIDERS.find(
    (candidate) => candidate.id === selectedProvider,
  )!;
  const connectionStates = useMemo(
    () =>
      new Map(
        PROVIDERS.map((candidate) => [
          candidate.id,
          providerStatus(candidate, runtimes, tokenPlans, connections),
        ]),
      ),
    [connections, runtimes, tokenPlans],
  );
  const configuredCount = [...connectionStates.values()].filter(
    (status) => status.tone === "ready",
  ).length;
  const runtime = runtimeFor(runtimes, provider.id);
  const selectedConnection = connections.find(
    (entry) => entry.provider === provider.id,
  );
  const selectedConnected = selectedConnection?.status === "connected";
  const checking =
    doctor.isFetching ||
    providerAuth.isFetching ||
    providerConnections.isFetching;

  const refresh = () => {
    void Promise.all([
      doctor.refetch(),
      providerAuth.refetch(),
      providerConnections.refetch(),
    ]);
  };

  return (
    <section aria-label="Configurações" className="control-page settings-hub">
      <header className="control-page__header settings-hub__header">
        <div>
          <span className="control-page__kicker">Central de conexões</span>
          <h1>Conecte seus agentes</h1>
          <p>
            Entre com suas assinaturas e Token Plans em um só lugar. Nenhum
            runtime usa cobrança pay-as-you-go ou troca de provider escondida.
          </p>
        </div>
        <button
          className="control-button"
          disabled={checking}
          onClick={refresh}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={checking ? "is-spinning" : undefined}
            size={15}
          />
          {checking ? "Verificando…" : "Verificar conexões"}
        </button>
      </header>

      <div className="settings-hub__assurance" role="note">
        <LockKeyhole aria-hidden="true" size={18} />
        <div>
          <strong>Seu plano continua sendo a fonte de acesso</strong>
          <span>
            {configuredCount} de {PROVIDERS.length} motores disponíveis ou
            configurados · segredos criptografados no dispositivo
          </span>
        </div>
        <span className="settings-hub__database">
          <Check aria-hidden="true" size={13} />
          {doctor.data?.database === "ok"
            ? "Cofre local íntegro"
            : "Verificando"}
        </span>
      </div>

      {doctor.isError && (
        <div className="settings-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>O núcleo local não respondeu</strong>
            <p>Reinicie o aplicativo e verifique as conexões novamente.</p>
          </div>
          <button onClick={refresh} type="button">
            Tentar novamente
          </button>
        </div>
      )}

      <div className="provider-switchboard">
        <nav aria-label="Providers" className="provider-switchboard__rail">
          <div className="provider-switchboard__rail-heading">
            <strong>Agentes e planos</strong>
            <span>{PROVIDERS.length}</span>
          </div>
          {PROVIDERS.map((candidate) => {
            const state = connectionStates.get(candidate.id)!;
            return (
              <button
                aria-current={selectedProvider === candidate.id}
                aria-label={`${candidate.label}: ${state.label}`}
                className="provider-switchboard__provider"
                data-selected={selectedProvider === candidate.id}
                key={candidate.id}
                onClick={() => {
                  setSelectedProvider(candidate.id);
                  setDeviceChallenge(undefined);
                  setInteractiveProvider(null);
                }}
                type="button"
              >
                <span data-provider={candidate.id}>{candidate.shortLabel}</span>
                <span>
                  <strong>{candidate.label}</strong>
                  <small>{state.label}</small>
                </span>
                <i data-tone={state.tone} />
              </button>
            );
          })}
        </nav>

        <section
          aria-label={`Configurar ${provider.label}`}
          className="provider-switchboard__detail"
        >
          <header>
            <div className="provider-switchboard__identity">
              <span data-provider={provider.id}>{provider.shortLabel}</span>
              <div>
                <small>
                  {provider.family === "subscription"
                    ? "Assinatura"
                    : provider.family === "token_plan"
                      ? "Token Plan"
                      : "Orquestrador"}
                </small>
                <h2>
                  {provider.id === "mimo"
                    ? "MiMo Token Plan"
                    : provider.id === "minimax"
                      ? "MiniMax Token Plan"
                      : provider.label}
                </h2>
              </div>
            </div>
            <span
              className="provider-switchboard__status"
              data-tone={connectionStates.get(provider.id)?.tone}
            >
              {connectionStates.get(provider.id)?.label}
            </span>
          </header>

          <p className="provider-switchboard__description">
            {provider.description}
          </p>
          <div className="provider-switchboard__ownership">
            <Blocks aria-hidden="true" size={15} />
            <span>
              <strong>{provider.ownership}</strong>
              <small>
                {provider.id === "claude"
                  ? "Se o Claude Code for removido do computador, somente este agente fica indisponível."
                  : provider.family === "token_plan"
                    ? "O OkamiCode conversa direto com o endpoint do plano fixo."
                    : "Não depende de uma instalação global no seu computador."}
              </small>
            </span>
          </div>

          {provider.auth === "device" && (
            <DeviceConnection
              challenge={
                deviceChallenge?.provider === provider.id
                  ? deviceChallenge
                  : undefined
              }
              error={
                startDeviceAuth.isError ? startDeviceAuth.error : undefined
              }
              pending={
                startDeviceAuth.isPending &&
                startDeviceAuth.variables?.provider === provider.id
              }
              provider={provider.id as "codex" | "grok"}
              connected={selectedConnected}
              onStart={() => {
                setDeviceChallenge(undefined);
                startDeviceAuth.mutate({
                  provider: provider.id as "codex" | "grok",
                });
              }}
            />
          )}

          {provider.auth === "interactive" && (
            <div className="provider-interactive">
              <div>
                <h3>Conexão guiada</h3>
                <p>
                  A autenticação oficial abre dentro do OkamiCode. Quando o
                  provider pedir navegador, conclua o login e volte para esta
                  tela.
                </p>
              </div>
              <button
                className="control-button control-button--primary"
                onClick={() =>
                  setInteractiveProvider(
                    provider.id as "claude" | "cursor" | "agy" | "opencode",
                  )
                }
                type="button"
              >
                <KeyRound aria-hidden="true" size={15} />
                {provider.id === "opencode"
                  ? "Gerenciar providers"
                  : selectedConnected
                    ? "Reconectar conta"
                    : "Conectar conta"}
              </button>
              {interactiveProvider === provider.id && (
                <ProviderAuthTerminal
                  key={provider.id}
                  onClose={() => {
                    setInteractiveProvider(null);
                    refresh();
                  }}
                  provider={
                    provider.id as "claude" | "cursor" | "agy" | "opencode"
                  }
                />
              )}
            </div>
          )}

          {provider.id === "mimo" && (
            <TokenPlanForm
              configured={
                tokenPlans.find((entry) => entry.provider === "mimo")
                  ?.configured ?? false
              }
              error={saveTokenPlan.isError ? saveTokenPlan.error : undefined}
              endpoint={tokenPlanDrafts.mimoBaseUrl}
              pending={saveTokenPlan.isPending || deleteTokenPlan.isPending}
              provider="mimo"
              token={tokenPlanDrafts.mimoToken}
              onEndpointChange={(mimoBaseUrl) =>
                setTokenPlanDrafts((current) => ({
                  ...current,
                  mimoBaseUrl,
                }))
              }
              onRemove={() => deleteTokenPlan.mutate({ provider: "mimo" })}
              onSave={() =>
                saveTokenPlan.mutate({
                  provider: "mimo",
                  token: tokenPlanDrafts.mimoToken,
                  baseUrl: tokenPlanDrafts.mimoBaseUrl,
                })
              }
              onTokenChange={(mimoToken) =>
                setTokenPlanDrafts((current) => ({ ...current, mimoToken }))
              }
            />
          )}

          {provider.id === "minimax" && (
            <TokenPlanForm
              configured={
                tokenPlans.find((entry) => entry.provider === "minimax")
                  ?.configured ?? false
              }
              error={saveTokenPlan.isError ? saveTokenPlan.error : undefined}
              pending={saveTokenPlan.isPending || deleteTokenPlan.isPending}
              provider="minimax"
              token={tokenPlanDrafts.minimaxToken}
              onRemove={() => deleteTokenPlan.mutate({ provider: "minimax" })}
              onSave={() =>
                saveTokenPlan.mutate({
                  provider: "minimax",
                  token: tokenPlanDrafts.minimaxToken,
                })
              }
              onTokenChange={(minimaxToken) =>
                setTokenPlanDrafts((current) => ({ ...current, minimaxToken }))
              }
            />
          )}

          <footer className="provider-switchboard__runtime">
            <span>
              Runtime
              <strong>
                {runtime?.version ??
                  (provider.family === "token_plan"
                    ? "Aguardando credencial"
                    : "Versão não detectada")}
              </strong>
            </span>
            <span>
              Transporte
              <strong>{runtime?.transportId ?? "Não iniciado"}</strong>
            </span>
            <span>
              Cobrança
              <strong>
                {provider.family === "token_plan"
                  ? "Plano fixo"
                  : provider.family === "subscription"
                    ? "Assinatura"
                    : "Do provider escolhido"}
              </strong>
            </span>
          </footer>
        </section>
      </div>

      <section className="settings-diagnostics">
        <button
          aria-expanded={diagnosticsOpen}
          className="settings-diagnostics__toggle"
          onClick={() => setDiagnosticsOpen((current) => !current)}
          type="button"
        >
          <span>
            <Wrench aria-hidden="true" size={16} />
            <span>
              <strong>Abrir diagnóstico técnico</strong>
              <small>
                Binários, versões, adapters e arquivos de configuração
              </small>
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            data-open={diagnosticsOpen}
            size={17}
          />
        </button>

        {diagnosticsOpen && (
          <div className="settings-diagnostics__body">
            <header>
              <div>
                <h2>Diagnóstico dos runtimes</h2>
                <p>
                  Aqui “pronto” mede o motor e o protocolo. A conexão da conta é
                  tratada acima.
                </p>
              </div>
              <button
                className="control-button"
                onClick={refresh}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} /> Verificar novamente
              </button>
            </header>
            <ul className="settings-client-list">
              {clients.map((client) => {
                const tone = statusTone(client);
                const managed = client.client !== "claude";
                return (
                  <li key={client.client}>
                    <div
                      className={`settings-client__icon settings-client__icon--${tone}`}
                    >
                      <TerminalSquare aria-hidden="true" size={17} />
                    </div>
                    <div className="settings-client__identity">
                      <strong>{client.label}</strong>
                      <span>
                        {managed
                          ? "Distribuído e verificado pelo OkamiCode"
                          : "Executável externo do Claude Code"}
                      </span>
                      <code>
                        {client.binaryPath ?? "Executável não localizado"}
                      </code>
                    </div>
                    <div className="settings-client__status">
                      <span
                        className={`connection-status connection-status--${tone === "ready" ? "ready" : tone === "offline" ? "offline" : "attention"}`}
                      >
                        {tone === "ready" ? (
                          <CheckCircle2 aria-hidden="true" size={13} />
                        ) : tone === "offline" ? (
                          <CircleDashed aria-hidden="true" size={13} />
                        ) : (
                          <AlertTriangle aria-hidden="true" size={13} />
                        )}
                        {INTEGRATION_LABELS[client.integrationStatus]}
                      </span>
                      <small>
                        {client.capabilities.length} capacidades verificadas
                      </small>
                    </div>
                    <button
                      className="control-button"
                      onClick={() => setInspectedClient(client)}
                      type="button"
                    >
                      Ver detalhes
                    </button>
                  </li>
                );
              })}
            </ul>
            {(settings.data?.length ?? 0) > 0 && (
              <div className="settings-diagnostics__files">
                <strong>Arquivos lidos</strong>
                {(settings.data ?? []).map((file) => (
                  <code key={file.path}>{file.path}</code>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {inspectedClient && (
        <aside
          aria-label={`Diagnóstico de ${inspectedClient.label}`}
          className="settings-inspector"
        >
          <header>
            <div>
              <span>Preflight do runtime</span>
              <h2>{inspectedClient.label}</h2>
            </div>
            <button
              aria-label="Fechar diagnóstico"
              onClick={() => setInspectedClient(null)}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </header>
          <div
            className={`settings-inspector__status settings-inspector__status--${statusTone(inspectedClient)}`}
          >
            <ShieldCheck aria-hidden="true" size={18} />
            <div>
              <strong>
                {INTEGRATION_LABELS[inspectedClient.integrationStatus]}
              </strong>
              <p>{inspectedClient.detail}</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Executável</dt>
              <dd>
                <code>{inspectedClient.binaryPath ?? "Não encontrado"}</code>
              </dd>
            </div>
            <div>
              <dt>Versão detectada</dt>
              <dd>{inspectedClient.version ?? "Versão não informada"}</dd>
            </div>
            <div>
              <dt>Propriedade</dt>
              <dd>
                {inspectedClient.client === "claude"
                  ? "Instalação externa do usuário"
                  : "Artefato gerenciado pelo OkamiCode"}
              </dd>
            </div>
          </dl>
          <section>
            <h3>Capacidades comprovadas</h3>
            <div className="settings-inspector__capabilities">
              {inspectedClient.capabilities.map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
          </section>
          <footer>
            <button className="control-button" onClick={refresh} type="button">
              <RefreshCw aria-hidden="true" size={14} /> Verificar novamente
            </button>
          </footer>
        </aside>
      )}
    </section>
  );
}

function DeviceConnection({
  challenge,
  connected,
  error,
  pending,
  provider,
  onStart,
}: {
  challenge?: IpcResponse<"providerAuth:startDevice">;
  connected: boolean;
  error?: unknown;
  pending: boolean;
  provider: "codex" | "grok";
  onStart: () => void;
}) {
  return (
    <div className="provider-device">
      <div>
        <h3>Conexão por dispositivo</h3>
        <p>
          O código é gerado pelo {provider === "codex" ? "OpenAI" : "xAI"} e
          autoriza somente sua assinatura.
        </p>
      </div>
      <button
        className="control-button control-button--primary"
        disabled={pending}
        onClick={onStart}
        type="button"
      >
        <KeyRound aria-hidden="true" size={15} />
        {pending
          ? "Gerando código…"
          : connected
            ? "Reconectar assinatura"
            : "Conectar assinatura"}
      </button>
      {challenge && (
        <div className="settings-device-challenge" role="status">
          <div>
            <strong>Código de conexão</strong>
            <p>Abra a página oficial e confirme este código.</p>
          </div>
          {challenge.userCode && <code>{challenge.userCode}</code>}
          <button
            className="control-button"
            onClick={() =>
              void workbenchClient.systemOpenExternal({
                url: challenge.verificationUrl,
              })
            }
            type="button"
          >
            <ExternalLink aria-hidden="true" size={14} />
            Abrir página oficial
          </button>
        </div>
      )}
      {error !== undefined && (
        <p className="settings-token-plans__error" role="alert">
          Não foi possível iniciar a conexão. Verifique o motor e tente
          novamente.
        </p>
      )}
    </div>
  );
}

function TokenPlanForm({
  configured,
  endpoint,
  error,
  pending,
  provider,
  token,
  onEndpointChange,
  onRemove,
  onSave,
  onTokenChange,
}: {
  configured: boolean;
  endpoint?: string;
  error?: unknown;
  pending: boolean;
  provider: "mimo" | "minimax";
  token: string;
  onEndpointChange?: (value: string) => void;
  onRemove: () => void;
  onSave: () => void;
  onTokenChange: (value: string) => void;
}) {
  return (
    <form
      className="provider-token-plan"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="provider-token-plan__intro">
        <KeyRound aria-hidden="true" size={17} />
        <div>
          <strong>
            {configured ? "Plano configurado" : "Informe os dados do seu plano"}
          </strong>
          <small>
            {provider === "mimo"
              ? "Aceita somente tp- no endpoint token-plan-*."
              : "Aceita somente a chave Coding Plan sk-cp-."}
          </small>
        </div>
      </div>
      {endpoint !== undefined && (
        <label>
          Endpoint do Token Plan
          <input
            onChange={(event) => onEndpointChange?.(event.target.value)}
            required
            type="url"
            value={endpoint}
          />
        </label>
      )}
      <label>
        Chave do Token Plan
        <input
          autoComplete="off"
          onChange={(event) => onTokenChange(event.target.value)}
          placeholder={provider === "mimo" ? "tp-…" : "sk-cp-…"}
          required
          type="password"
          value={token}
        />
      </label>
      {provider === "minimax" && (
        <p className="provider-token-plan__hint">
          O endpoint oficial é aplicado pelo OkamiCode.
        </p>
      )}
      <div className="provider-token-plan__actions">
        <button
          className="control-button control-button--primary"
          disabled={pending}
          type="submit"
        >
          <Save aria-hidden="true" size={14} />
          {configured ? "Atualizar conexão" : "Salvar e conectar"}
        </button>
        {configured && (
          <button
            className="control-button"
            disabled={pending}
            onClick={onRemove}
            type="button"
          >
            Remover conexão
          </button>
        )}
      </div>
      {error !== undefined && (
        <p className="settings-token-plans__error" role="alert">
          A credencial foi recusada. Confirme se ela pertence ao Token Plan fixo
          deste provider.
        </p>
      )}
    </form>
  );
}
