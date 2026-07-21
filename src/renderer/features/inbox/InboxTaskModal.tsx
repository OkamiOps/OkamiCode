import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import { Bot, CheckSquare, UserRound, X } from "lucide-react";
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
    try {
      await onCreateTask({
        threadId: thread.id,
        mode,
        laneId: mode === "delegate" ? selectedLaneId : null,
        title: trimmedTitle,
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
          Virar tarefa
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
          Virar tarefa
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
                    <Bot aria-hidden="true" size={14} />
                    <span>
                      <strong>Preparar para agente</strong>
                      <small>Associa uma lane; não inicia execução.</small>
                    </span>
                  </label>
                </fieldset>

                {mode === "delegate" && (
                  <section
                    className="inbox-task-lanes"
                    aria-label="Lanes disponíveis"
                  >
                    <p className="inbox-section-label">Lane com workspace</p>
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
                          <div className="inbox-task-lanes__list">
                            {eligibleLanes.map((lane) => (
                              <label
                                aria-label={`${lane.model} — ${lane.providerAccountLabel}`}
                                data-selected={
                                  selectedLaneId === lane.laneId || undefined
                                }
                                htmlFor={`inbox-task-lane-${lane.laneId}`}
                                key={lane.laneId}
                              >
                                <input
                                  checked={selectedLaneId === lane.laneId}
                                  id={`inbox-task-lane-${lane.laneId}`}
                                  name="lane"
                                  onChange={() => {
                                    setSelectedLaneId(lane.laneId);
                                    setError(null);
                                  }}
                                  type="radio"
                                  value={lane.laneId}
                                />
                                <span>
                                  <strong>{lane.model}</strong>
                                  <small>
                                    {lane.providerAccountLabel} ·{" "}
                                    {lane.workspacePath}
                                  </small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}

                <p className="inbox-task-safety">
                  Nenhum agente será iniciado.
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
