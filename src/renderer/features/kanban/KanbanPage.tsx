import { Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileText,
  MoreHorizontal,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import type {
  IpcRequest,
  IpcResponse,
  KanbanCardContract,
} from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";

type KanbanStatus = KanbanCardContract["status"];
type KanbanMutation = IpcResponse<"kanban:move">;
type Lane = IpcResponse<"lane:list">[number];

interface KanbanApi {
  list(): Promise<KanbanCardContract[]>;
  listLanes(): Promise<Lane[]>;
  create(request: IpcRequest<"kanban:create">): Promise<KanbanMutation>;
  move(request: IpcRequest<"kanban:move">): Promise<KanbanMutation>;
  update(request: IpcRequest<"kanban:update">): Promise<KanbanMutation>;
  delete(
    request: IpcRequest<"kanban:delete">,
  ): Promise<IpcResponse<"kanban:delete">>;
  assign(request: IpcRequest<"kanban:assign">): Promise<KanbanMutation>;
}

const defaultApi: KanbanApi = {
  list: workbenchClient.kanbanList,
  listLanes: () => workbenchClient.laneList({}),
  create: workbenchClient.kanbanCreate,
  move: workbenchClient.kanbanMove,
  update: workbenchClient.kanbanUpdate,
  delete: workbenchClient.kanbanDelete,
  assign: workbenchClient.kanbanAssign,
};

const COLUMNS: Array<{
  status: KanbanStatus;
  label: string;
  description: string;
}> = [
  { status: "backlog", label: "Entrada", description: "Definir e priorizar" },
  {
    status: "in_progress",
    label: "Em andamento",
    description: "Trabalho ativo",
  },
  { status: "review", label: "Revisão", description: "Validar a entrega" },
  { status: "done", label: "Concluído", description: "Resultado confirmado" },
];

export function KanbanPage({ api = defaultApi }: { api?: KanbanApi }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [laneId, setLaneId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cards = useQuery({ queryKey: ["kanban"], queryFn: api.list });
  const lanes = useQuery({
    queryKey: ["workbench", "lanes", "all"],
    queryFn: api.listLanes,
  });
  const selected = (cards.data ?? []).find((card) => card.id === selectedId);
  const laneById = useMemo(
    () => new Map((lanes.data ?? []).map((lane) => [lane.laneId, lane])),
    [lanes.data],
  );

  const openCard = (card: KanbanCardContract) => {
    setSelectedId(card.id);
    setEditingTitle(card.title);
    setEditingDescription(card.description);
    setConfirmDelete(false);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["kanban"] });
  const reportMutation = (result: KanbanMutation) => {
    setNotice(
      result.wake.shouldWake
        ? `Agente acordado: ${result.wake.reason}.`
        : `Alteração salva: ${result.wake.reason}.`,
    );
    void refresh();
  };
  const createCard = useMutation({
    mutationFn: api.create,
    onSuccess: reportMutation,
  });
  const moveCard = useMutation({
    mutationFn: api.move,
    onSuccess: reportMutation,
  });
  const updateCard = useMutation({
    mutationFn: api.update,
    onSuccess: reportMutation,
  });
  const assignCard = useMutation({
    mutationFn: api.assign,
    onSuccess: reportMutation,
  });
  const deleteCard = useMutation({
    mutationFn: api.delete,
    onSuccess: () => {
      setNotice("Tarefa excluída do quadro.");
      setConfirmDelete(false);
      setSelectedId(null);
      void refresh();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) return;
    createCard.mutate({
      title: title.trim(),
      description: description.trim(),
      status: "backlog",
      ownerKind: laneId ? "lane" : "human",
      laneId: laneId || null,
      activationPolicy: laneId ? "relevant_change" : "manual",
    });
    setTitle("");
    setDescription("");
    setLaneId("");
    setCreating(false);
  }

  function move(card: KanbanCardContract, status: KanbanStatus) {
    if (card.status === status) return;
    moveCard.mutate({
      cardId: card.id,
      status,
      position: (cards.data ?? []).filter((item) => item.status === status)
        .length,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function drop(event: DragEvent<HTMLElement>, status: KanbanStatus) {
    event.preventDefault();
    const card = (cards.data ?? []).find(
      (item) =>
        item.id === event.dataTransfer.getData("application/x-okami-card"),
    );
    if (card) move(card, status);
  }

  return (
    <section aria-label="Kanban" className="kanban-page">
      <header className="kanban-header">
        <div>
          <span className="kanban-eyebrow">CENTRAL DE EXECUÇÃO</span>
          <h1>Tarefas</h1>
          <p>
            Cada card tem uma diretriz, um dono e uma regra explícita de
            ativação.
          </p>
        </div>
        <Button
          className="kanban-new"
          onPress={() => setCreating((value) => !value)}
        >
          {creating ? (
            <X aria-hidden="true" size={15} />
          ) : (
            <Plus aria-hidden="true" size={15} />
          )}
          {creating ? "Fechar" : "Nova tarefa"}
        </Button>
      </header>

      <div className="kanban-summary" aria-label="Resumo do quadro">
        <span>
          <CircleDot aria-hidden="true" size={14} />
          {cards.data?.length ?? 0} tarefas
        </span>
        <span>
          <Bot aria-hidden="true" size={14} />
          {
            (cards.data ?? []).filter((card) => card.ownerKind === "lane")
              .length
          }{" "}
          delegadas
        </span>
        <span>
          <CheckCircle2 aria-hidden="true" size={14} />
          {
            (cards.data ?? []).filter((card) => card.status === "done").length
          }{" "}
          concluídas
        </span>
      </div>

      {creating && (
        <form className="kanban-create" onSubmit={submit}>
          <div className="kanban-create__copy">
            <FileText aria-hidden="true" size={18} />
            <div>
              <strong>Defina o trabalho antes de escolher o agente</strong>
              <small>Sem diretriz não existe delegação confiável.</small>
            </div>
          </div>
          <label>
            <span>Título</span>
            <input
              aria-label="Título da tarefa"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Resultado em uma linha"
              value={title}
            />
          </label>
          <label className="kanban-create__instruction">
            <span>Diretriz / prompt</span>
            <textarea
              aria-label="Diretriz da tarefa"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Descreva o resultado esperado, restrições e quando pedir aprovação…"
              rows={4}
              value={description}
            />
          </label>
          <label>
            <span>Responsável</span>
            <select
              aria-label="Responsável"
              onChange={(event) => setLaneId(event.target.value)}
              value={laneId}
            >
              <option value="">Eu · execução manual</option>
              {(lanes.data ?? []).map((lane) => (
                <option key={lane.laneId} value={lane.laneId}>
                  {lane.providerAccountLabel} · {lane.model} ·{" "}
                  {lane.workspacePath ?? "sem workspace"}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="kanban-create__submit"
            isDisabled={!title.trim() || !description.trim()}
            type="submit"
          >
            Criar tarefa
          </Button>
        </form>
      )}

      {notice && (
        <p aria-live="polite" className="kanban-notice">
          {notice}
        </p>
      )}
      {cards.isLoading && <p className="kanban-state">Carregando quadro…</p>}
      {cards.isError && (
        <p className="kanban-state kanban-state--error">
          Não foi possível carregar o Kanban.
        </p>
      )}

      <div
        className={`kanban-workspace${selected ? " kanban-workspace--inspecting" : ""}`}
      >
        <div className="kanban-board">
          {COLUMNS.map((column, columnIndex) => {
            const columnCards = (cards.data ?? []).filter(
              (card) => card.status === column.status,
            );
            return (
              <section
                aria-label={column.label}
                className="kanban-column"
                key={column.status}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => drop(event, column.status)}
              >
                <header className="kanban-column__header">
                  <span
                    className={`kanban-column__dot kanban-column__dot--${column.status}`}
                  />
                  <div>
                    <h2>{column.label}</h2>
                    <p>{column.description}</p>
                  </div>
                  <span className="kanban-column__count">
                    {columnCards.length}
                  </span>
                </header>
                <div className="kanban-column__cards">
                  {columnCards.map((card) => {
                    const lane = laneById.get(card.laneId ?? "");
                    return (
                      <article
                        className={`kanban-card${selectedId === card.id ? " kanban-card--selected" : ""}`}
                        draggable
                        key={card.id}
                        onDragStart={(event) =>
                          event.dataTransfer.setData(
                            "application/x-okami-card",
                            card.id,
                          )
                        }
                      >
                        <div className="kanban-card__topline">
                          <span
                            className={`kanban-owner kanban-owner--${card.ownerKind}`}
                          >
                            {card.ownerKind === "lane" ? (
                              <Bot aria-hidden="true" size={12} />
                            ) : (
                              <UserRound aria-hidden="true" size={12} />
                            )}
                            {card.ownerKind === "lane"
                              ? (lane?.model ?? "Agente")
                              : "Eu"}
                          </span>
                          <Button
                            aria-label={`Abrir ações de ${card.title}`}
                            className="kanban-card__more"
                            isIconOnly
                            onPress={() => openCard(card)}
                            variant="ghost"
                          >
                            <MoreHorizontal aria-hidden="true" size={15} />
                          </Button>
                        </div>
                        <h3>{card.title}</h3>
                        <p>{card.description}</p>
                        <footer className="kanban-card__footer">
                          <Button
                            aria-label={`Mover ${card.title} para ${COLUMNS[columnIndex - 1]?.label ?? "coluna anterior"}`}
                            className="kanban-card__move"
                            isDisabled={columnIndex === 0 || moveCard.isPending}
                            isIconOnly
                            onPress={() =>
                              move(card, COLUMNS[columnIndex - 1]!.status)
                            }
                            variant="ghost"
                          >
                            <ArrowLeft aria-hidden="true" size={13} />
                          </Button>
                          <span>{policyLabel(card.activationPolicy)}</span>
                          <Button
                            aria-label={`Mover ${card.title} para ${COLUMNS[columnIndex + 1]?.label ?? "próxima coluna"}`}
                            className="kanban-card__move"
                            isDisabled={
                              columnIndex === COLUMNS.length - 1 ||
                              moveCard.isPending
                            }
                            isIconOnly
                            onPress={() =>
                              move(card, COLUMNS[columnIndex + 1]!.status)
                            }
                            variant="ghost"
                          >
                            <ArrowRight aria-hidden="true" size={13} />
                          </Button>
                        </footer>
                      </article>
                    );
                  })}
                  {columnCards.length === 0 && (
                    <div className="kanban-column__empty">
                      <span>Solte uma tarefa aqui</span>
                      <small>ou use “Nova tarefa”</small>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {selected && (
          <aside aria-label="Detalhes da tarefa" className="kanban-inspector">
            <header>
              <div>
                <span>CONTROLE DA TAREFA</span>
                <h2>{selected.title}</h2>
              </div>
              <Button
                aria-label="Fechar detalhes"
                isIconOnly
                onPress={() => setSelectedId(null)}
                variant="ghost"
              >
                <X aria-hidden="true" size={16} />
              </Button>
            </header>
            <div className="kanban-inspector__meta">
              <span>
                <Clock3 aria-hidden="true" size={13} />
                {
                  COLUMNS.find((column) => column.status === selected.status)
                    ?.label
                }
              </span>
              <span>
                <ShieldCheck aria-hidden="true" size={13} />
                {policyLabel(selected.activationPolicy)}
              </span>
            </div>
            <label>
              <span>Título</span>
              <input
                aria-label="Editar título da tarefa"
                onChange={(event) => setEditingTitle(event.target.value)}
                value={editingTitle}
              />
            </label>
            <label>
              <span>Diretriz / prompt</span>
              <textarea
                aria-label="Editar diretriz da tarefa"
                onChange={(event) => setEditingDescription(event.target.value)}
                rows={10}
                value={editingDescription}
              />
            </label>
            <label>
              <span>Responsável</span>
              <select
                aria-label="Editar responsável"
                onChange={(event) => {
                  const nextLane = event.target.value;
                  assignCard.mutate({
                    cardId: selected.id,
                    ownerKind: nextLane ? "lane" : "human",
                    laneId: nextLane || null,
                    activationPolicy: nextLane ? "relevant_change" : "manual",
                    idempotencyKey: crypto.randomUUID(),
                  });
                }}
                value={
                  selected.ownerKind === "lane" ? (selected.laneId ?? "") : ""
                }
              >
                <option value="">Eu · manual</option>
                {(lanes.data ?? []).map((lane) => (
                  <option key={lane.laneId} value={lane.laneId}>
                    {lane.providerAccountLabel} · {lane.model}
                  </option>
                ))}
              </select>
            </label>
            {laneById.get(selected.laneId ?? "")?.workspacePath && (
              <div className="kanban-inspector__workspace">
                <span>Workspace</span>
                <code>
                  {laneById.get(selected.laneId ?? "")?.workspacePath}
                </code>
              </div>
            )}
            <div className="kanban-inspector__actions">
              <Button
                className="kanban-inspector__save"
                isDisabled={
                  !editingTitle.trim() ||
                  !editingDescription.trim() ||
                  updateCard.isPending
                }
                onPress={() =>
                  updateCard.mutate({
                    cardId: selected.id,
                    title: editingTitle.trim(),
                    description: editingDescription.trim(),
                    idempotencyKey: crypto.randomUUID(),
                  })
                }
              >
                <Save aria-hidden="true" size={14} />
                Salvar alterações
              </Button>
              <Button
                className="kanban-inspector__delete"
                onPress={() => setConfirmDelete(true)}
                variant="ghost"
              >
                <Trash2 aria-hidden="true" size={14} />
                Excluir
              </Button>
            </div>
          </aside>
        )}
      </div>

      {selected && confirmDelete && (
        <div className="kanban-confirm-backdrop" role="presentation">
          <section
            aria-label="Excluir tarefa"
            aria-modal="true"
            className="kanban-confirm"
            role="dialog"
          >
            <span className="kanban-confirm__icon">
              <Trash2 aria-hidden="true" size={18} />
            </span>
            <h2>Excluir esta tarefa?</h2>
            <p>
              “{selected.title}” será removida do quadro. O e-mail de origem, se
              existir, não será apagado.
            </p>
            <div>
              <Button
                onPress={() => setConfirmDelete(false)}
                variant="secondary"
              >
                Cancelar
              </Button>
              <Button
                className="kanban-confirm__danger"
                isDisabled={deleteCard.isPending}
                onPress={() =>
                  deleteCard.mutate({
                    cardId: selected.id,
                    confirmation: "delete_kanban_card",
                  })
                }
              >
                {deleteCard.isPending ? "Excluindo…" : "Excluir tarefa"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function policyLabel(policy: KanbanCardContract["activationPolicy"]): string {
  if (policy === "status_transition") return "Acorda ao mover";
  if (policy === "relevant_change") return "Acorda se houver mudança";
  return "Execução manual";
}
