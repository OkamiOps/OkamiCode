import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  CircleDashed,
  Database,
  FolderCog,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

type CliCapability = IpcResponse<"system:doctor">["clients"][number];

const PERMISSION_LABELS: Record<string, string> = {
  manual: "Manual",
  acceptEdits: "Aceitar edições",
  plan: "Planejar",
  auto: "Automático",
  bypassPermissions: "Ignorar permissões",
};

const INTEGRATION_LABELS = {
  ready: "Operacional",
  needs_adapter: "Adapter incompleto",
  update_required: "Atualização necessária",
  unavailable: "Não encontrado",
} as const;

function statusTone(client: CliCapability): "ready" | "warning" | "offline" {
  if (client.integrationStatus === "ready") return "ready";
  if (client.integrationStatus === "unavailable") return "offline";
  return "warning";
}

export function SettingsPage() {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const effortByLane = useWorkbenchStore((state) => state.effortByLane);
  const [inspectedClient, setInspectedClient] = useState<CliCapability | null>(
    null,
  );
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const task = (tasks.data ?? []).find((entry) => entry.id === selectedTaskId);
  const lanes = useQuery({
    queryKey: ["workbench", "lanes", task?.id],
    queryFn: () => workbenchClient.laneList(task ? { taskId: task.id } : {}),
    enabled: Boolean(task),
  });
  const settings = useQuery({
    queryKey: ["eco", "settings"],
    queryFn: () => workbenchClient.ecoSettings(),
  });
  const doctor = useQuery({
    queryKey: ["system", "doctor"],
    queryFn: () => workbenchClient.systemDoctor(),
  });
  const checking = doctor.isFetching || settings.isFetching;
  const clients = doctor.data?.clients ?? [];
  const readyCount = clients.filter(
    (client) => client.integrationStatus === "ready",
  ).length;
  const attentionCount = clients.filter((client) =>
    ["needs_adapter", "update_required"].includes(client.integrationStatus),
  ).length;

  const refresh = () => {
    void Promise.all([doctor.refetch(), settings.refetch()]);
  };

  return (
    <section aria-label="Configurações" className="control-page">
      <header className="control-page__header">
        <div>
          <span className="control-page__kicker">Diagnóstico local</span>
          <h1>Configurações</h1>
          <p>
            Saúde real dos CLIs, compatibilidade com os adapters e arquivos que
            influenciam o comportamento do OkamiCode.
          </p>
        </div>
        <button
          className="control-button control-button--primary"
          disabled={checking}
          onClick={refresh}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={checking ? "is-spinning" : undefined}
            size={15}
          />
          {checking ? "Verificando…" : "Verificar atualizações"}
        </button>
      </header>

      <div className="settings-health" aria-label="Resumo da saúde do sistema">
        <div data-tone="ready">
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>
            <strong>
              {readyCount} de {clients.length}
            </strong>
            <small>CLIs operacionais</small>
          </span>
        </div>
        <div data-tone={attentionCount > 0 ? "warning" : "ready"}>
          <AlertTriangle aria-hidden="true" size={18} />
          <span>
            <strong>{attentionCount}</strong>
            <small>pedem atenção</small>
          </span>
        </div>
        <div data-tone={doctor.data?.database === "ok" ? "ready" : "offline"}>
          <Database aria-hidden="true" size={18} />
          <span>
            <strong>
              {doctor.data?.database === "ok"
                ? "SQLite íntegro"
                : "Verificando banco"}
            </strong>
            <small>estado local do aplicativo</small>
          </span>
        </div>
      </div>

      {doctor.isError && (
        <div className="settings-alert" role="alert">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>Não foi possível concluir o diagnóstico</strong>
            <p>
              O núcleo não respondeu. Reinicie o aplicativo e tente verificar
              novamente.
            </p>
          </div>
          <button onClick={refresh} type="button">
            Tentar novamente
          </button>
        </div>
      )}

      <section className="control-section settings-clients">
        <header>
          <div>
            <h2>CLIs e adapters</h2>
            <p>
              “Instalado” não significa “compatível”; o protocolo é verificado
              separadamente.
            </p>
          </div>
          <span>{clients.length}</span>
        </header>
        {doctor.isLoading ? (
          <div className="control-skeleton" aria-label="Verificando CLIs" />
        ) : (
          <ul className="settings-client-list">
            {clients.map((client) => {
              const tone = statusTone(client);
              return (
                <li key={client.client}>
                  <div
                    className={`settings-client__icon settings-client__icon--${tone}`}
                  >
                    <TerminalSquare aria-hidden="true" size={17} />
                  </div>
                  <div className="settings-client__identity">
                    <strong>{client.label}</strong>
                    <span>{client.version ?? "Versão indisponível"}</span>
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
                    {client.integrationStatus === "update_required"
                      ? "Revisar atualização"
                      : "Ver detalhes"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="settings-grid">
        <section className="control-section">
          <header>
            <div>
              <h2>Runtimes ativos</h2>
              <p>Resultado do handshake com cada adapter.</p>
            </div>
            <span>{doctor.data?.runtimes.length ?? 0}</span>
          </header>
          <ul className="settings-runtime-list">
            {(doctor.data?.runtimes ?? []).map((runtime) => (
              <li key={runtime.runtime}>
                <span data-status={runtime.status} />
                <div>
                  <strong>{runtime.runtime}</strong>
                  <small>{runtime.version ?? "versão indisponível"}</small>
                </div>
                <em>
                  {runtime.status === "ready"
                    ? "Pronto"
                    : runtime.status === "degraded"
                      ? "Protocolo incompatível"
                      : "Indisponível"}
                </em>
              </li>
            ))}
          </ul>
        </section>

        <section className="control-section">
          <header>
            <div>
              <h2>Conversa atual</h2>
              <p>Workspace, modelo e política da tarefa aberta.</p>
            </div>
            <span>{task ? "Ativa" : "Sem tarefa"}</span>
          </header>
          {!task ? (
            <div className="control-empty control-empty--small">
              <FolderCog aria-hidden="true" size={19} />
              <strong>Nenhuma tarefa selecionada</strong>
              <p>Abra um projeto no Code para inspecionar suas lanes.</p>
            </div>
          ) : (
            <dl className="settings-lane-facts">
              <div>
                <dt>Workspace</dt>
                <dd>
                  <code>{task.workspacePath ?? "Não vinculado"}</code>
                </dd>
              </div>
              {(lanes.data ?? []).map((lane) => (
                <div key={lane.laneId}>
                  <dt>{lane.providerAccountLabel}</dt>
                  <dd>
                    <strong>{lane.model}</strong>
                    <span>
                      {lane.routeKind} ·{" "}
                      {PERMISSION_LABELS[lane.permissionMode ?? "manual"] ??
                        lane.permissionMode}
                      {effortByLane[lane.laneId]
                        ? ` · ${effortByLane[lane.laneId]}`
                        : ""}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>

      <section className="control-section settings-configs">
        <header>
          <div>
            <h2>Fontes de configuração</h2>
            <p>
              Leitura somente: os próprios CLIs continuam sendo a fonte de
              verdade.
            </p>
          </div>
          <span>{settings.data?.length ?? 0}</span>
        </header>
        <ul>
          {(settings.data ?? []).map((file) => (
            <li key={file.path}>
              <Wrench aria-hidden="true" size={15} />
              <div>
                <code>{file.path}</code>
                <small>
                  {file.exists
                    ? `${file.keys.length} seções${file.effortLevel ? ` · effort ${file.effortLevel}` : ""}${file.theme ? ` · tema ${file.theme}` : ""}`
                    : "Arquivo ausente"}
                </small>
              </div>
              {file.enabledPlugins && (
                <span>{file.enabledPlugins.length} plugins</span>
              )}
            </li>
          ))}
        </ul>
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
              <dd>{inspectedClient.version ?? "O CLI não informou versão"}</dd>
            </div>
            <div>
              <dt>Papel</dt>
              <dd>
                {inspectedClient.role === "runtime"
                  ? "Runtime de conversa"
                  : "Launcher de recurso"}
              </dd>
            </div>
          </dl>
          <section>
            <h3>Capacidades comprovadas</h3>
            {inspectedClient.capabilities.length === 0 ? (
              <p>Nenhuma capacidade foi comprovada pelo probe local.</p>
            ) : (
              <div className="settings-inspector__capabilities">
                {inspectedClient.capabilities.map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>
            )}
          </section>
          <section className="settings-update-guard">
            <h3>
              <Cable aria-hidden="true" size={15} /> Atualização protegida
            </h3>
            {inspectedClient.integrationStatus === "update_required" ? (
              <>
                <ol>
                  <li>Executável e versão foram detectados.</li>
                  <li>O adapter atual marcou o protocolo como incompatível.</li>
                  <li>
                    O Okami não possui um atualizador oficial comprovado para
                    este CLI.
                  </li>
                </ol>
                <p>
                  Nenhum comando será executado até existir um updater
                  allowlisted com verificação pós-instalação. Atualizar às cegas
                  seria só trocar um bug conhecido por outro surpresa.
                </p>
              </>
            ) : (
              <p>
                O CLI não declarou uma atualização necessária. “Verificar
                novamente” repete o probe local sem baixar ou instalar nada.
              </p>
            )}
          </section>
          <footer>
            <button className="control-button" onClick={refresh} type="button">
              <RefreshCw aria-hidden="true" size={14} /> Verificar novamente
            </button>
            <button
              className="control-button control-button--primary"
              disabled
              title="Atualizador oficial ainda não integrado"
              type="button"
            >
              Atualizar CLI
            </button>
          </footer>
        </aside>
      )}
    </section>
  );
}
