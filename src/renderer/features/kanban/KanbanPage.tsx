import { Button, Card } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Plus,
  Sparkles,
  UserRound,
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

interface KanbanApi {
  list(): Promise<KanbanCardContract[]>;
  listLanes(): Promise<Array<{ laneId: string; model: string }>>;
  create(request: IpcRequest<"kanban:create">): Promise<KanbanMutation>;
  move(request: IpcRequest<"kanban:move">): Promise<KanbanMutation>;
  assign(request: IpcRequest<"kanban:assign">): Promise<KanbanMutation>;
}

const defaultApi: KanbanApi = {
  list: workbenchClient.kanbanList,
  listLanes: () =>
    workbenchClient
      .laneList({})
      .then((lanes) => lanes.map(({ laneId, model }) => ({ laneId, model }))),
  create: workbenchClient.kanbanCreate,
  move: workbenchClient.kanbanMove,
  assign: workbenchClient.kanbanAssign,
};

const COLUMNS: Array<{
  status: KanbanStatus;
  label: string;
  description: string;
}> = [
  { status: "backlog", label: "Entrada", description: "Ideias e pedidos" },
  {
    status: "in_progress",
    label: "Em andamento",
    description: "Trabalho ativo",
  },
  { status: "review", label: "Revisão", description: "Aguardando validação" },
  { status: "done", label: "Concluído", description: "Entrega confirmada" },
];

export function KanbanPage({ api = defaultApi }: { api?: KanbanApi }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [laneId, setLaneId] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  const cards = useQuery({ queryKey: ["kanban"], queryFn: api.list });
  const lanes = useQuery({
    queryKey: ["workbench", "lanes", "all"],
    queryFn: api.listLanes,
  });
  const laneById = useMemo(
    () => new Map((lanes.data ?? []).map((lane) => [lane.laneId, lane.model])),
    [lanes.data],
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["kanban"] });
  const reportMutation = (result: KanbanMutation) => {
    setNotice(
      result.wake.shouldWake
        ? `Agente acordado: ${result.wake.reason}.`
        : `Card atualizado sem acordar agente: ${result.wake.reason}.`,
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
  const assignCard = useMutation({
    mutationFn: api.assign,
    onSuccess: reportMutation,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    createCard.mutate({
      title: title.trim(),
      description: description.trim(),
      status: "backlog",
      ownerKind: laneId ? "lane" : "human",
      laneId: laneId || null,
      activationPolicy: laneId ? "status_transition" : "manual",
    });
    setTitle("");
    setDescription("");
    setCreating(false);
  }

  function move(card: KanbanCardContract, status: KanbanStatus) {
    if (card.status === status) return;
    const position = (cards.data ?? []).filter(
      (item) => item.status === status,
    ).length;
    moveCard.mutate({
      cardId: card.id,
      status,
      position,
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
          <span className="kanban-eyebrow">PLANEJAMENTO LOCAL</span>
          <h1>Kanban</h1>
          <p>
            Você trabalha manualmente ou delega um card para uma lane existente.
          </p>
        </div>
        <Button
          className="kanban-new"
          onPress={() => setCreating((value) => !value)}
        >
          <Plus aria-hidden="true" size={15} />
          Nova tarefa
        </Button>
      </header>

      <div className="kanban-summary" aria-label="Resumo do quadro">
        <span>
          <CircleDot aria-hidden="true" size={14} />
          {cards.data?.length ?? 0} cards
        </span>
        <span>
          <Bot aria-hidden="true" size={14} />
          {
            (cards.data ?? []).filter((card) => card.ownerKind === "lane")
              .length
          }{" "}
          delegados
        </span>
        <span>
          <CheckCircle2 aria-hidden="true" size={14} />
          {
            (cards.data ?? []).filter((card) => card.status === "done").length
          }{" "}
          concluídos
        </span>
      </div>

      {creating && (
        <form className="kanban-create" onSubmit={submit}>
          <div className="kanban-create__copy">
            <Sparkles aria-hidden="true" size={16} />
            <div>
              <strong>Criar tarefa</strong>
              <small>Manual por padrão; selecione uma lane para delegar.</small>
            </div>
          </div>
          <input
            aria-label="Título da tarefa"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="O que precisa ser feito?"
            value={title}
          />
          <input
            aria-label="Descrição da tarefa"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Contexto opcional"
            value={description}
          />
          <select
            aria-label="Responsável"
            onChange={(event) => setLaneId(event.target.value)}
            value={laneId}
          >
            <option value="">Eu · manual</option>
            {(lanes.data ?? []).map((lane) => (
              <option key={lane.laneId} value={lane.laneId}>
                {lane.model} · acordar em transições
              </option>
            ))}
          </select>
          <Button
            className="kanban-create__submit"
            isDisabled={!title.trim()}
            type="submit"
          >
            Criar
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
                {columnCards.map((card) => (
                  <Card
                    className="kanban-card"
                    draggable
                    key={card.id}
                    onDragStart={(event) =>
                      event.dataTransfer.setData(
                        "application/x-okami-card",
                        card.id,
                      )
                    }
                  >
                    <Card.Content className="kanban-card__content">
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
                            ? (laneById.get(card.laneId ?? "") ?? "Agente")
                            : "Eu"}
                        </span>
                        <span className="kanban-card__policy">
                          {policyLabel(card.activationPolicy)}
                        </span>
                      </div>
                      <h3>{card.title}</h3>
                      {card.description && <p>{card.description}</p>}
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
                        <select
                          aria-label={`Responsável por ${card.title}`}
                          className="kanban-card__assign"
                          onChange={(event) => {
                            const selectedLaneId = event.target.value;
                            assignCard.mutate({
                              cardId: card.id,
                              ownerKind: selectedLaneId ? "lane" : "human",
                              laneId: selectedLaneId || null,
                              activationPolicy: selectedLaneId
                                ? "status_transition"
                                : "manual",
                              idempotencyKey: crypto.randomUUID(),
                            });
                          }}
                          value={
                            card.ownerKind === "lane" ? (card.laneId ?? "") : ""
                          }
                        >
                          <option value="">Eu</option>
                          {(lanes.data ?? []).map((lane) => (
                            <option key={lane.laneId} value={lane.laneId}>
                              {lane.model}
                            </option>
                          ))}
                        </select>
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
                    </Card.Content>
                  </Card>
                ))}
                {columnCards.length === 0 && (
                  <div className="kanban-column__empty">Solte um card aqui</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function policyLabel(policy: KanbanCardContract["activationPolicy"]): string {
  if (policy === "status_transition") return "ao mover";
  if (policy === "relevant_change") return "se mudar";
  return "manual";
}
