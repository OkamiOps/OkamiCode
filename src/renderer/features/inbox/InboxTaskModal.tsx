import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import {
  ArrowRight,
  Bot,
  CheckSquare,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import {
  modelOptions,
  providerOptions,
  realWorkspaceLanes,
  resolveLane,
  workspaceOptions,
} from "./lane-selection";

type InboxThread = IpcResponse<"inbox:threads:list">["threads"][number];
type Lane = IpcResponse<"lane:list">[number];
type CreateTaskRequest = IpcRequest<"inbox:thread:createTask">;

interface InboxTaskModalProps {
  isCreating: boolean;
  listLanes: (request: IpcRequest<"lane:list">) => Promise<Lane[]>;
  onCreateTask: (request: CreateTaskRequest) => Promise<unknown>;
  thread: InboxThread | undefined;
}

type TaskMode = "manual" | "delegate";

export function InboxTaskModal({
  isCreating,
  listLanes,
  onCreateTask,
  thread,
}: InboxTaskModalProps) {
  const [mode, setMode] = useState<TaskMode>("manual");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedWorkspace, setSelectedWorkspace] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [lanes, setLanes] = useState<Lane[] | null>(null);
  const [lanesError, setLanesError] = useState<string | null>(null);
  const [isLoadingLanes, setIsLoadingLanes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (isOpen && thread) {
        idempotencyKey.current = createUuid();
        setMode("manual");
        setTitle(thread.subject.trim() || "E-mail sem assunto");
        setInstruction("");
        setSelectedProvider("");
        setSelectedModel("");
        setSelectedWorkspace("");
        setModelQuery("");
        setLanes(null);
        setLanesError(null);
        setError(null);
      }
      if (!isOpen) {
        idempotencyKey.current = null;
        setError(null);
      }
    },
  });

  const eligibleLanes = useMemo(() => realWorkspaceLanes(lanes ?? []), [lanes]);
  const providers = useMemo(
    () => providerOptions(eligibleLanes),
    [eligibleLanes],
  );
  const models = useMemo(
    () => modelOptions(eligibleLanes, selectedProvider),
    [eligibleLanes, selectedProvider],
  );
  const visibleModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return models;
    return models.filter((model) =>
      model.label.toLocaleLowerCase("pt-BR").includes(query),
    );
  }, [modelQuery, models]);
  const workspaces = useMemo(
    () => workspaceOptions(eligibleLanes, selectedProvider, selectedModel),
    [eligibleLanes, selectedModel, selectedProvider],
  );
  const selectedLane = useMemo(
    () =>
      resolveLane(
        eligibleLanes,
        selectedProvider,
        selectedModel,
        selectedWorkspace,
      ),
    [eligibleLanes, selectedModel, selectedProvider, selectedWorkspace],
  );

  async function chooseDelegate() {
    setMode("delegate");
    setError(null);
    if (lanes !== null || isLoadingLanes) return;
    setIsLoadingLanes(true);
    try {
      setLanes(await listLanes({}));
    } catch (cause) {
      setLanesError(messageFor(cause, "Não foi possível carregar as lanes."));
    } finally {
      setIsLoadingLanes(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!thread) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Informe um título para a tarefa.");
      return;
    }
    if (mode === "delegate" && !selectedLane) {
      setError("Escolha provider, modelo e projeto para preparar a tarefa.");
      return;
    }
    if (!instruction.trim()) {
      setError("Descreva o resultado esperado para esta tarefa.");
      return;
    }
    try {
      await onCreateTask({
        threadId: thread.id,
        mode,
        laneId: mode === "delegate" ? (selectedLane?.laneId ?? null) : null,
        title: trimmedTitle,
        instruction: instruction.trim(),
        idempotencyKey: idempotencyKey.current ?? createUuid(),
      });
      state.close();
    } catch (cause) {
      setError(messageFor(cause, "Não foi possível criar a tarefa."));
    }
  }

  return (
    <Modal.Root state={state}>
      {thread ? (
        <Modal.Trigger
          aria-label="Virar tarefa"
          className="inbox-future-action inbox-future-action--task"
        >
          <CheckSquare aria-hidden="true" size={14} />
          Tarefa
        </Modal.Trigger>
      ) : (
        <Button
          aria-label="Virar tarefa"
          className="inbox-future-action inbox-future-action--task"
          isDisabled
          size="sm"
          variant="ghost"
        >
          <CheckSquare aria-hidden="true" size={14} />
          Tarefa
        </Button>
      )}
      <Modal.Backdrop className="inbox-modal-backdrop">
        <Modal.Container className="inbox-task-modal" placement="center">
          <Modal.Dialog>
            <form onSubmit={submit}>
              <Modal.Header className="inbox-task-modal__header">
                <span className="inbox-task-modal__mark">
                  <CheckSquare aria-hidden="true" size={16} />
                </span>
                <div>
                  <span className="inbox-workflow-modal__eyebrow">
                    Fluxo de trabalho
                  </span>
                  <Modal.Heading>Transformar em tarefa</Modal.Heading>
                  <p>Defina o resultado e decida quem acompanha a execução.</p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar criação de tarefa"
                  className="inbox-modal-close"
                >
                  <X aria-hidden="true" size={15} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="inbox-task-modal__body">
                <div className="inbox-workflow-modal__main">
                  <section className="inbox-workflow-modal__section">
                    <header>
                      <span>01</span>
                      <div>
                        <h3>Resultado esperado</h3>
                        <p>
                          O card nasce com uma diretriz clara e verificável.
                        </p>
                      </div>
                    </header>
                    <label className="inbox-form-field">
                      <span>Título da tarefa</span>
                      <input
                        aria-label="Título da tarefa"
                        onChange={(event) => setTitle(event.target.value)}
                        value={title}
                      />
                    </label>

                    <label className="inbox-form-field inbox-form-field--instruction">
                      <span>O que precisa ser feito?</span>
                      <textarea
                        aria-label="Instrução da tarefa"
                        maxLength={4000}
                        onChange={(event) => {
                          setInstruction(event.target.value);
                          setError(null);
                        }}
                        placeholder="Ex.: valide a cobrança, identifique o risco e prepare os próximos passos. Não responda ao remetente sem minha aprovação."
                        rows={5}
                        value={instruction}
                      />
                      <small>
                        <span>Diretriz usada no card e pelo agente.</span>
                        <span>{instruction.length}/4000</span>
                      </small>
                    </label>
                  </section>

                  <section className="inbox-workflow-modal__section">
                    <header>
                      <span>02</span>
                      <div>
                        <h3>Responsabilidade</h3>
                        <p>
                          Você mantém o controle ou delega o acompanhamento.
                        </p>
                      </div>
                    </header>
                    <fieldset className="inbox-task-mode">
                      <legend className="sr-only">Responsabilidade</legend>
                      <label data-selected={mode === "manual" || undefined}>
                        <input
                          checked={mode === "manual"}
                          name="task-mode"
                          onChange={() => {
                            setMode("manual");
                            setError(null);
                          }}
                          type="radio"
                          value="manual"
                        />
                        <UserRound aria-hidden="true" size={16} />
                        <span>
                          <strong>Eu assumo</strong>
                          <small>
                            Card manual, sem consumir uma assinatura.
                          </small>
                        </span>
                      </label>
                      <label data-selected={mode === "delegate" || undefined}>
                        <input
                          checked={mode === "delegate"}
                          name="task-mode"
                          onChange={() => void chooseDelegate()}
                          type="radio"
                          value="delegate"
                        />
                        <Bot aria-hidden="true" size={16} />
                        <span>
                          <strong>Delegar acompanhamento</strong>
                          <small>
                            Vincula modelo e workspace ao acompanhamento.
                          </small>
                        </span>
                      </label>
                    </fieldset>
                  </section>

                  {mode === "delegate" && (
                    <section
                      className="inbox-task-lanes"
                      aria-label="Lanes disponíveis"
                    >
                      <p className="inbox-section-label">Agente e workspace</p>
                      {isLoadingLanes && (
                        <p className="inbox-task-lanes__state" role="status">
                          <Spinner size="sm" /> Carregando lanes…
                        </p>
                      )}
                      {lanesError && (
                        <p className="inbox-form-error" role="alert">
                          {lanesError}
                        </p>
                      )}
                      {!isLoadingLanes && !lanesError && lanes !== null && (
                        <>
                          {eligibleLanes.length === 0 ? (
                            <p className="inbox-task-lanes__state">
                              Nenhuma lane com workspace está disponível.
                            </p>
                          ) : (
                            <div className="inbox-task-lanes__picker">
                              <label className="inbox-form-field">
                                <span>Provider</span>
                                <select
                                  aria-label="Provider da tarefa"
                                  onChange={(event) => {
                                    setSelectedProvider(event.target.value);
                                    setSelectedModel("");
                                    setSelectedWorkspace("");
                                    setModelQuery("");
                                    setError(null);
                                  }}
                                  value={selectedProvider}
                                >
                                  <option value="">Escolha a assinatura</option>
                                  {providers.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="inbox-task-lanes__model">
                                {models.length > 10 && (
                                  <label className="inbox-form-field inbox-task-lanes__search">
                                    <span>Buscar modelo</span>
                                    <input
                                      aria-label="Buscar modelo da tarefa"
                                      disabled={!selectedProvider}
                                      onChange={(event) =>
                                        setModelQuery(event.target.value)
                                      }
                                      placeholder={`Filtrar ${models.length} modelos…`}
                                      type="search"
                                      value={modelQuery}
                                    />
                                  </label>
                                )}
                                <label className="inbox-form-field">
                                  <span>Modelo</span>
                                  <select
                                    aria-label="Modelo da tarefa"
                                    disabled={!selectedProvider}
                                    onChange={(event) => {
                                      setSelectedModel(event.target.value);
                                      setSelectedWorkspace("");
                                      setError(null);
                                    }}
                                    value={selectedModel}
                                  >
                                    <option value="">Escolha o modelo</option>
                                    {visibleModels.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  {models.length > 10 && (
                                    <small>
                                      {visibleModels.length} de {models.length}{" "}
                                      modelos
                                    </small>
                                  )}
                                </label>
                              </div>
                              <label className="inbox-form-field inbox-task-lanes__workspace">
                                <span>Projeto / workspace</span>
                                <select
                                  aria-label="Projeto da tarefa"
                                  disabled={!selectedModel}
                                  onChange={(event) => {
                                    setSelectedWorkspace(event.target.value);
                                    setError(null);
                                  }}
                                  value={selectedWorkspace}
                                >
                                  <option value="">Escolha o projeto</option>
                                  {workspaces.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  )}
                  {error && (
                    <p className="inbox-form-error" role="alert">
                      {error}
                    </p>
                  )}
                </div>

                <aside className="inbox-workflow-modal__aside">
                  <div className="inbox-workflow-modal__source">
                    <span className="inbox-workflow-modal__source-icon">
                      <Mail aria-hidden="true" size={17} />
                    </span>
                    <span className="inbox-workflow-modal__eyebrow">
                      Email de origem
                    </span>
                    <strong>{thread?.subject || "Sem assunto"}</strong>
                    <small>
                      {thread?.participants[0] || "Remetente indisponível"}
                    </small>
                    <p>{thread?.snippet || "Sem prévia disponível."}</p>
                  </div>
                  <div className="inbox-workflow-modal__outcome">
                    <span className="inbox-workflow-modal__eyebrow">
                      O que acontece agora
                    </span>
                    <div>
                      <ShieldCheck aria-hidden="true" size={16} />
                      <span>
                        <strong>Nenhuma mensagem será enviada</strong>
                        <small>O email permanece ligado ao card.</small>
                      </span>
                    </div>
                    <div>
                      <ArrowRight aria-hidden="true" size={16} />
                      <span>
                        <strong>
                          {mode === "delegate"
                            ? "Agente acompanha mudanças"
                            : "Você controla a execução"}
                        </strong>
                        <small>
                          {mode === "delegate"
                            ? "Só acorda quando houver atualização relevante."
                            : "Nenhuma assinatura será consumida; nenhum agente será iniciado."}
                        </small>
                      </span>
                    </div>
                  </div>
                </aside>
              </Modal.Body>
              <Modal.Footer className="inbox-task-modal__footer">
                <Button
                  className="inbox-task-modal__cancel"
                  onPress={state.close}
                  size="sm"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button
                  className="inbox-task-modal__submit"
                  isDisabled={isCreating}
                  size="sm"
                  type="submit"
                >
                  {isCreating ? "Criando…" : "Criar tarefa"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function createUuid() {
  return globalThis.crypto.randomUUID();
}

function messageFor(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
