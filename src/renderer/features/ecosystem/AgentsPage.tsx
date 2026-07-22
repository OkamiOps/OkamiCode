import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Check,
  CopyPlus,
  Pencil,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

const STORAGE_KEY = "okami.local-agent-profiles.v1";
const CAPABILITIES = [
  "Ler workspace",
  "Editar arquivos",
  "Executar terminal",
  "Usar navegador",
  "Revisar Git",
] as const;

interface LocalAgentProfile {
  id: string;
  name: string;
  description: string;
  runtimeKind: string;
  providerLabel: string;
  model: string;
  effort: string;
  workspacePath: string;
  capabilities: string[];
}

const emptyProfile: LocalAgentProfile = {
  id: "",
  name: "",
  description: "",
  runtimeKind: "",
  providerLabel: "",
  model: "",
  effort: "",
  workspacePath: "",
  capabilities: ["Ler workspace"],
};

function loadProfiles(): LocalAgentProfile[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? (value as LocalAgentProfile[]) : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: LocalAgentProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function AgentsPage() {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const workspacePath =
    (tasks.data ?? []).find((task) => task.id === selectedTaskId)
      ?.workspacePath ?? undefined;
  const discovered = useQuery({
    queryKey: ["eco", "agents", workspacePath],
    queryFn: () =>
      workbenchClient.ecoAgents(workspacePath ? { workspacePath } : {}),
  });
  const catalog = useQuery({
    queryKey: ["workbench", "models"],
    queryFn: () => workbenchClient.modelsList(),
  });
  const [profiles, setProfiles] = useState(loadProfiles);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<LocalAgentProfile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

  const workspaces = useMemo(
    () => [
      ...new Set(
        (tasks.data ?? []).flatMap((task) => task.workspacePath ?? []),
      ),
    ],
    [tasks.data],
  );
  const provider = (catalog.data ?? []).find(
    (entry) => entry.runtimeKind === draft?.runtimeKind,
  );
  const model = provider?.models.find((entry) => entry.id === draft?.model);
  const term = filter.trim().toLowerCase();
  const visibleProfiles = profiles.filter(
    (agent) =>
      term === "" ||
      agent.name.toLowerCase().includes(term) ||
      agent.description.toLowerCase().includes(term),
  );
  const visibleDiscovered = (discovered.data ?? []).filter(
    (agent) =>
      term === "" ||
      agent.name.toLowerCase().includes(term) ||
      agent.description.toLowerCase().includes(term),
  );

  const dispatch = (agent: LocalAgentProfile | { name: string }) => {
    if (!selectedTaskId) return;
    const instruction =
      "runtimeKind" in agent
        ? `Use o agente ${agent.name} com ${agent.providerLabel} · ${agent.model}${agent.effort ? ` · effort ${agent.effort}` : ""}. Respeite estas capacidades: ${agent.capabilities.join(", ")}. Tarefa: `
        : `Use o subagente ${agent.name} para: `;
    localStorage.setItem(`okami.draft.${selectedTaskId}`, instruction);
    navigate("/workbench");
    window.location.reload();
  };

  const startCreate = () => {
    const firstProvider = catalog.data?.find(
      (entry) => entry.models.length > 0,
    );
    setDraft({
      ...emptyProfile,
      id: crypto.randomUUID(),
      runtimeKind: firstProvider?.runtimeKind ?? "",
      providerLabel: firstProvider?.providerLabel ?? "",
      model: firstProvider?.models[0]?.id ?? "",
      effort: firstProvider?.models[0]?.defaultEffort ?? "",
      workspacePath: workspacePath ?? workspaces[0] ?? "",
    });
    setConfirmDelete(false);
  };

  const persistDraft = () => {
    if (!draft?.name.trim() || !draft.model) return;
    const next = [
      ...profiles.filter((profile) => profile.id !== draft.id),
      {
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
      },
    ].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
    setProfiles(next);
    saveProfiles(next);
    setDraft(null);
  };

  const deleteDraft = () => {
    if (!draft) return;
    const next = profiles.filter((profile) => profile.id !== draft.id);
    setProfiles(next);
    saveProfiles(next);
    setDraft(null);
    setConfirmDelete(false);
  };

  return (
    <section aria-label="Agentes" className="control-page">
      <header className="control-page__header">
        <div>
          <span className="control-page__kicker">Inteligência local</span>
          <h1>Agentes</h1>
          <p>
            Perfis reutilizáveis que combinam modelo, workspace e limites de
            atuação antes de uma tarefa chegar ao composer.
          </p>
        </div>
        <button
          className="control-button control-button--primary"
          onClick={startCreate}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Criar agente
        </button>
      </header>

      <div className="agent-flow" aria-label="Como os agentes funcionam">
        <span>
          <Bot aria-hidden="true" size={16} />
          <strong>Perfil</strong>
          <small>modelo e limites</small>
        </span>
        <i aria-hidden="true" />
        <span>
          <ShieldCheck aria-hidden="true" size={16} />
          <strong>Você confirma</strong>
          <small>nenhuma execução automática</small>
        </span>
        <i aria-hidden="true" />
        <span>
          <Play aria-hidden="true" size={16} />
          <strong>Composer</strong>
          <small>instrução pronta para revisar</small>
        </span>
      </div>

      <div className="control-toolbar">
        <label className="control-search">
          <Search aria-hidden="true" size={15} />
          <span className="sr-only">Buscar agentes</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Buscar por nome ou função…"
          />
        </label>
        <span className="control-toolbar__summary">
          {profiles.length} locais · {discovered.data?.length ?? 0} descobertos
        </span>
      </div>

      <div
        className="agent-workspace"
        data-editing={Boolean(draft) || undefined}
      >
        <main className="agent-sections">
          <section className="control-section">
            <header>
              <div>
                <h2>Meus agentes</h2>
                <p>Salvos somente neste Mac e editáveis pelo OkamiCode.</p>
              </div>
              <span>{profiles.length}</span>
            </header>
            {visibleProfiles.length === 0 ? (
              <div className="control-empty">
                <Bot aria-hidden="true" size={20} />
                <strong>Nenhum perfil local</strong>
                <p>
                  Crie um agente para não repetir provider, modelo e limites em
                  cada tarefa.
                </p>
                <button onClick={startCreate} type="button">
                  Criar primeiro agente
                </button>
              </div>
            ) : (
              <ul className="agent-list">
                {visibleProfiles.map((agent) => (
                  <li key={agent.id}>
                    <div className="agent-list__avatar">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="agent-list__content">
                      <strong>{agent.name}</strong>
                      <p>{agent.description || "Sem descrição"}</p>
                      <div>
                        <span>
                          {agent.providerLabel} · {agent.model}
                        </span>
                        <span>
                          {agent.workspacePath || "Sem workspace fixo"}
                        </span>
                      </div>
                    </div>
                    <div className="agent-list__actions">
                      <button
                        aria-label={`Editar ${agent.name}`}
                        onClick={() => {
                          setDraft(agent);
                          setConfirmDelete(false);
                        }}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={14} />
                      </button>
                      <button
                        className="control-button"
                        disabled={!selectedTaskId}
                        onClick={() => dispatch(agent)}
                        type="button"
                      >
                        <Play aria-hidden="true" size={13} /> Usar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="control-section">
            <header>
              <div>
                <h2>Descobertos no Claude</h2>
                <p>
                  Definições existentes no usuário, plugins e workspace atual.
                </p>
              </div>
              <span>{discovered.data?.length ?? 0}</span>
            </header>
            {discovered.isLoading ? (
              <div className="control-skeleton" aria-label="Lendo agentes" />
            ) : (
              <ul className="agent-list agent-list--compact">
                {visibleDiscovered.map((agent) => (
                  <li key={`${agent.source}-${agent.name}`}>
                    <div className="agent-list__avatar agent-list__avatar--discovered">
                      CL
                    </div>
                    <div className="agent-list__content">
                      <strong>{agent.name}</strong>
                      <p>{agent.description || "Definição sem descrição"}</p>
                      <div>
                        <span>{agent.model ?? "modelo herdado"}</span>
                        <span>{agent.source}</span>
                      </div>
                    </div>
                    <div className="agent-list__actions">
                      <button
                        aria-label={`Criar cópia de ${agent.name}`}
                        onClick={() => {
                          startCreate();
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  name: `${agent.name} local`,
                                  description: agent.description,
                                  model: agent.model ?? current.model,
                                }
                              : current,
                          );
                        }}
                        title="Criar perfil editável"
                        type="button"
                      >
                        <CopyPlus aria-hidden="true" size={14} />
                      </button>
                      <button
                        className="control-button"
                        disabled={!selectedTaskId}
                        onClick={() => dispatch(agent)}
                        type="button"
                      >
                        <Play aria-hidden="true" size={13} /> Usar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        {draft && (
          <aside
            aria-label={
              profiles.some((profile) => profile.id === draft.id)
                ? "Editar agente"
                : "Criar agente"
            }
            className="agent-editor"
          >
            <header>
              <div>
                <span>Perfil local</span>
                <h2>
                  {profiles.some((profile) => profile.id === draft.id)
                    ? "Editar agente"
                    : "Novo agente"}
                </h2>
              </div>
              <button
                aria-label="Fechar editor"
                onClick={() => setDraft(null)}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </header>
            <label>
              Nome
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Ex.: Revisor de segurança"
              />
            </label>
            <label>
              Função
              <textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                placeholder="Explique quando e para que este agente deve ser usado."
              />
            </label>
            <div className="agent-editor__grid">
              <label>
                Provider
                <select
                  value={draft.runtimeKind}
                  onChange={(event) => {
                    const next = catalog.data?.find(
                      (entry) => entry.runtimeKind === event.target.value,
                    );
                    setDraft({
                      ...draft,
                      runtimeKind: event.target.value,
                      providerLabel: next?.providerLabel ?? event.target.value,
                      model: next?.models[0]?.id ?? "",
                      effort: next?.models[0]?.defaultEffort ?? "",
                    });
                  }}
                >
                  {(catalog.data ?? [])
                    .filter((entry) => entry.models.length > 0)
                    .map((entry) => (
                      <option key={entry.runtimeKind} value={entry.runtimeKind}>
                        {entry.providerLabel}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Modelo
                <select
                  value={draft.model}
                  onChange={(event) => {
                    const nextModel = provider?.models.find(
                      (entry) => entry.id === event.target.value,
                    );
                    setDraft({
                      ...draft,
                      model: event.target.value,
                      effort: nextModel?.defaultEffort ?? "",
                    });
                  }}
                >
                  {(provider?.models ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Effort
                <select
                  value={draft.effort}
                  onChange={(event) =>
                    setDraft({ ...draft, effort: event.target.value })
                  }
                >
                  <option value="">Padrão do modelo</option>
                  {(model?.efforts ?? []).map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Workspace
                <select
                  value={draft.workspacePath}
                  onChange={(event) =>
                    setDraft({ ...draft, workspacePath: event.target.value })
                  }
                >
                  <option value="">Escolher ao usar</option>
                  {workspaces.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Capacidades permitidas</legend>
              <p>
                Esses limites viram uma diretriz explícita; o runtime ainda
                aplica as próprias aprovações.
              </p>
              {CAPABILITIES.map((capability) => (
                <label key={capability}>
                  <input
                    checked={draft.capabilities.includes(capability)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        capabilities: event.target.checked
                          ? [...draft.capabilities, capability]
                          : draft.capabilities.filter(
                              (entry) => entry !== capability,
                            ),
                      })
                    }
                    type="checkbox"
                  />
                  <span>
                    <Check aria-hidden="true" size={12} />
                    {capability}
                  </span>
                </label>
              ))}
            </fieldset>
            <footer>
              {profiles.some((profile) => profile.id === draft.id) &&
                (confirmDelete ? (
                  <div className="agent-editor__confirm">
                    <span>Excluir este perfil local?</span>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button onClick={deleteDraft} type="button">
                      Excluir
                    </button>
                  </div>
                ) : (
                  <button
                    className="control-button control-button--danger"
                    onClick={() => setConfirmDelete(true)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} /> Excluir
                  </button>
                ))}
              <button
                className="control-button control-button--primary"
                disabled={!draft.name.trim() || !draft.model}
                onClick={persistDraft}
                type="button"
              >
                <Check aria-hidden="true" size={14} /> Salvar agente
              </button>
            </footer>
          </aside>
        )}
      </div>
    </section>
  );
}
