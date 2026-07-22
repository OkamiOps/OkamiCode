import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import { Bot, CheckSquare, FolderKanban, UserRound, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";

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
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
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
        setSelectedLaneId(null);
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

  const eligibleLanes = useMemo(
    () => (lanes ?? []).filter((lane) => lane.workspacePath !== null),
    [lanes],
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
    if (mode === "delegate" && !selectedLaneId) {
      setError("Escolha uma lane com workspace para preparar a tarefa.");
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
        laneId: mode === "delegate" ? selectedLaneId : null,
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
                  <Modal.Heading>Transformar em tarefa</Modal.Heading>
                  <p>O email continua como referência na conversa.</p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar criação de tarefa"
                  className="inbox-modal-close"
                >
                  <X aria-hidden="true" size={15} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="inbox-task-modal__body">
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
                    Esta é a diretriz que ficará no card e orientará o agente.
                    {` ${instruction.length}/4000`}
                  </small>
                </label>

                <fieldset className="inbox-task-mode">
                  <legend>Responsabilidade</legend>
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
                    <UserRound aria-hidden="true" size={14} />
                    <span>
                      <strong>Eu faço</strong>
                      <small>Cria o card sem atribuição de agente.</small>
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
                    <FolderKanban aria-hidden="true" size={14} />
                    <span>
                      <strong>Delegar acompanhamento</strong>
                      <small>
                        O agente assume o card e observa atualizações.
                      </small>
                    </span>
                  </label>
                </fieldset>

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
                          <label className="inbox-form-field">
                            <span>Execução vinculada</span>
                            <select
                              aria-label="Agente e workspace"
                              onChange={(event) => {
                                setSelectedLaneId(event.target.value || null);
                                setError(null);
                              }}
                              value={selectedLaneId ?? ""}
                            >
                              <option value="">
                                Selecione agente, modelo e pasta
                              </option>
                              {eligibleLanes.map((lane) => (
                                <option key={lane.laneId} value={lane.laneId}>
                                  {lane.providerAccountLabel} · {lane.model} ·{" "}
                                  {lane.workspacePath}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </>
                    )}
                  </section>
                )}

                <p className="inbox-task-safety">
                  <Bot aria-hidden="true" size={13} />
                  {mode === "delegate"
                    ? "O agente será acordado apenas quando houver mudança relevante no card ou no e-mail."
                    : "A tarefa fica sob seu controle; nenhum agente será iniciado."}
                </p>
                {error && (
                  <p className="inbox-form-error" role="alert">
                    {error}
                  </p>
                )}
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
