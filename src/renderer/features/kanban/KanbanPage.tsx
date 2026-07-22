import { Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileText,
  Filter,
  FolderOpen,
  LayoutGrid,
  Mail,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import type {
  IpcRequest,
  IpcResponse,
  KanbanCardContract,
} from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";

type KanbanStatus = KanbanCardContract["status"];
type KanbanMutation = IpcResponse<"kanban:move">;
type Lane = IpcResponse<"lane:list">[number];
type OwnerFilter = "all" | KanbanCardContract["ownerKind"];

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
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
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
  const allCards = useMemo(() => cards.data ?? [], [cards.data]);
  const selected = allCards.find((card) => card.id === selectedId);
  const laneById = useMemo(
    () => new Map((lanes.data ?? []).map((lane) => [lane.laneId, lane])),
    [lanes.data],
  );
  const visibleCards = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return allCards.filter((card) => {
      const ownerMatches =
        ownerFilter === "all" || card.ownerKind === ownerFilter;
      const textMatches =
        !needle ||
        `${card.title} ${card.description}`
          .toLocaleLowerCase("pt-BR")
          .includes(needle);
      return ownerMatches && textMatches;
    });
  }, [allCards, ownerFilter, search]);

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
      position: allCards.filter((item) => item.status === status).length,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function drop(event: DragEvent<HTMLElement>, status: KanbanStatus) {
    event.preventDefault();
    const card = allCards.find(
      (item) =>
        item.id === event.dataTransfer.getData("application/x-okami-card"),
    );
    if (card) move(card, status);
  }

  const delegated = allCards.filter((card) => card.ownerKind === "lane").length;
  const done = allCards.filter((card) => card.status === "done").length;

  useEffect(() => {
    if (!creating && !confirmDelete) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmDelete) setConfirmDelete(false);
      else setCreating(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmDelete, creating]);

  return (
    <section aria-label="Kanban" className="kanban-page">
      <header className="kanban-header">
        <div className="kanban-header__identity">
          <span className="kanban-eyebrow">CENTRAL DE EXECUÇÃO</span>
          <h1>Tarefas</h1>
          <p>
            Organize o trabalho, decida quem assume e acompanhe cada entrega.
          </p>
        </div>
        <div className="kanban-header__actions">
          <span className="kanban-sync-state">
            <Activity aria-hidden="true" size={14} />
            Sincronizado localmente
          </span>
          <Button className="kanban-new" onPress={() => setCreating(true)}>
            <Plus aria-hidden="true" size={16} />
            Nova tarefa
          </Button>
        </div>
      </header>

      <section aria-label="Pulso do fluxo" className="kanban-pulse">
        <div className="kanban-pulse__lead">
          <span>Pulso do fluxo</span>
          <strong>{allCards.length} tarefas ativas no quadro</strong>
        </div>
        <div className="kanban-pulse__track" aria-hidden="true">
          {COLUMNS.map((column) => {
            const count = allCards.filter(
              (card) => card.status === column.status,
            ).length;
            return (
              <span
                className={`kanban-pulse__segment kanban-pulse__segment--${column.status}`}
                key={column.status}
                style={{ flexGrow: Math.max(1, count) }}
              />
            );
          })}
        </div>
        <div className="kanban-pulse__metric">
          <Bot aria-hidden="true" size={16} />
          <span>
            <strong>{delegated}</strong> delegadas
          </span>
        </div>
        <div className="kanban-pulse__metric">
          <CheckCircle2 aria-hidden="true" size={16} />
          <span>
            <strong>{done}</strong> concluídas
          </span>
        </div>
      </section>

      <div className="kanban-toolbar">
        <label className="kanban-search">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="Buscar tarefas"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por título ou diretriz…"
            role="searchbox"
            value={search}
          />
          {search && (
            <button
              aria-label="Limpar busca"
              onClick={() => setSearch("")}
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          )}
        </label>
        <div className="kanban-filter" aria-label="Filtrar responsável">
          <Filter aria-hidden="true" size={15} />
          <Button
            className={ownerFilter === "all" ? "is-active" : ""}
            onPress={() => setOwnerFilter("all")}
            variant="ghost"
          >
            Todas
          </Button>
          <Button
            className={ownerFilter === "human" ? "is-active" : ""}
            onPress={() => setOwnerFilter("human")}
            variant="ghost"
          >
            Minhas
          </Button>
          <Button
            className={ownerFilter === "lane" ? "is-active" : ""}
            onPress={() => setOwnerFilter("lane")}
            variant="ghost"
          >
            Agentes
          </Button>
        </div>
        <span className="kanban-toolbar__count">
          <LayoutGrid aria-hidden="true" size={14} />
          {visibleCards.length} visíveis
        </span>
      </div>

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

      <div className="kanban-workspace">
        <div className="kanban-board">
          {COLUMNS.map((column, columnIndex) => {
            const columnCards = visibleCards
              .filter((card) => card.status === column.status)
              .sort((left, right) => left.position - right.position);
            return (
              <section
                aria-label={column.label}
                className={`kanban-column kanban-column--${column.status}`}
                key={column.status}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => drop(event, column.status)}
              >
                <header className="kanban-column__header">
                  <span className="kanban-column__icon">
                    {column.status === "done" ? (
                      <CheckCircle2 aria-hidden="true" size={16} />
                    ) : (
                      <CircleDot aria-hidden="true" size={16} />
                    )}
                  </span>
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
                    const workspace = lane?.workspacePath
                      ?.split("/")
                      .filter(Boolean)
                      .at(-1);
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
                        <div
                          className="kanban-card__accent"
                          aria-hidden="true"
                        />
                        <div className="kanban-card__topline">
                          <span
                            className={`kanban-owner kanban-owner--${card.ownerKind}`}
                          >
                            {card.ownerKind === "lane" ? (
                              <Bot aria-hidden="true" size={13} />
                            ) : (
                              <UserRound aria-hidden="true" size={13} />
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
                            <MoreHorizontal aria-hidden="true" size={16} />
                          </Button>
                        </div>
                        <button
                          aria-label={`Abrir tarefa ${card.title}`}
                          className="kanban-card__body"
                          onClick={() => openCard(card)}
                          type="button"
                        >
                          <h3>{card.title}</h3>
                          <p>{card.description}</p>
                          <span className="kanban-card__context">
                            <span>
                              {card.taskId ? (
                                <Mail aria-hidden="true" size={12} />
                              ) : (
                                <FileText aria-hidden="true" size={12} />
                              )}
                              {card.taskId
                                ? "Originada por e-mail"
                                : "Tarefa local"}
                            </span>
                            {workspace && (
                              <span title={lane?.workspacePath ?? undefined}>
                                <FolderOpen aria-hidden="true" size={12} />
                                {workspace}
                              </span>
                            )}
                          </span>
                        </button>
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
                            <ArrowLeft aria-hidden="true" size={14} />
                          </Button>
                          <span className="kanban-card__policy">
                            <ShieldCheck aria-hidden="true" size={12} />
                            {policyLabel(card.activationPolicy)}
                          </span>
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
                            <ArrowRight aria-hidden="true" size={14} />
                          </Button>
                        </footer>
                      </article>
                    );
                  })}
                  {columnCards.length === 0 && (
                    <div className="kanban-column__empty">
                      <span className="kanban-column__empty-icon">
                        <Sparkles aria-hidden="true" size={16} />
                      </span>
                      <strong>
                        {search || ownerFilter !== "all"
                          ? "Nada neste filtro"
                          : "Etapa livre"}
                      </strong>
                      <small>
                        {search || ownerFilter !== "all"
                          ? "Ajuste a busca ou os responsáveis."
                          : "Arraste uma tarefa para cá."}
                      </small>
                      {!search && ownerFilter === "all" && (
                        <Button
                          aria-label={`Criar tarefa em ${column.label}`}
                          onPress={() => setCreating(true)}
                          variant="ghost"
                        >
                          <Plus aria-hidden="true" size={13} /> Criar aqui
                        </Button>
                      )}
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
              <div className="kanban-inspector__heading">
                <span className="kanban-inspector__kicker">TAREFA EM FOCO</span>
                <h2>{selected.title}</h2>
                <p>Edite a diretriz, mova o trabalho ou troque quem assume.</p>
              </div>
              <Button
                aria-label="Fechar detalhes"
                isIconOnly
                onPress={() => setSelectedId(null)}
                variant="ghost"
              >
                <X aria-hidden="true" size={18} />
              </Button>
            </header>
            <div className="kanban-inspector__meta">
              <span className={`is-${selected.status}`}>
                <Clock3 aria-hidden="true" size={14} />
                {
                  COLUMNS.find((column) => column.status === selected.status)
                    ?.label
                }
              </span>
              <span>
                <ShieldCheck aria-hidden="true" size={14} />
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
              <span>Etapa</span>
              <select
                aria-label="Editar etapa"
                onChange={(event) =>
                  move(selected, event.target.value as KanbanStatus)
                }
                value={selected.status}
              >
                {COLUMNS.map((column) => (
                  <option key={column.status} value={column.status}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="kanban-inspector__directive">
              <span>Diretriz / prompt</span>
              <textarea
                aria-label="Editar diretriz da tarefa"
                onChange={(event) => setEditingDescription(event.target.value)}
                rows={11}
                value={editingDescription}
              />
              <small>
                Explique o resultado, as restrições e quando pedir aprovação.
              </small>
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
                <option value="">Eu · execução manual</option>
                {(lanes.data ?? []).map((lane) => (
                  <option key={lane.laneId} value={lane.laneId}>
                    {lane.providerAccountLabel} · {lane.model}
                  </option>
                ))}
              </select>
            </label>
            {laneById.get(selected.laneId ?? "")?.workspacePath && (
              <div className="kanban-inspector__workspace">
                <span>
                  <FolderOpen aria-hidden="true" size={13} /> Workspace
                </span>
                <code>
                  {laneById.get(selected.laneId ?? "")?.workspacePath}
                </code>
              </div>
            )}
            <div className="kanban-inspector__actions">
              <Button
                className="kanban-inspector__delete"
                onPress={() => setConfirmDelete(true)}
                variant="ghost"
              >
                <Trash2 aria-hidden="true" size={15} /> Excluir
              </Button>
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
                <Save aria-hidden="true" size={15} /> Salvar alterações
              </Button>
            </div>
          </aside>
        )}
      </div>

      {creating && (
        <div
          className="kanban-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCreating(false);
          }}
          role="presentation"
        >
          <form
            aria-label="Criar nova tarefa"
            aria-modal="true"
            className="kanban-create"
            onSubmit={submit}
            role="dialog"
          >
            <header>
              <span className="kanban-create__icon">
                <FileText aria-hidden="true" size={20} />
              </span>
              <div>
                <span>NOVA TAREFA</span>
                <h2>Defina o trabalho antes de escolher quem executa</h2>
                <p>
                  Uma boa diretriz evita retrabalho e ação errada do agente.
                </p>
              </div>
              <Button
                aria-label="Fechar nova tarefa"
                className="kanban-modal__close"
                isIconOnly
                onPress={() => setCreating(false)}
                variant="ghost"
              >
                <X aria-hidden="true" size={18} />
              </Button>
            </header>
            <label>
              <span>Título da tarefa</span>
              <input
                aria-label="Título da tarefa"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Qual resultado precisa existir?"
                value={title}
              />
            </label>
            <label>
              <span>Diretriz / prompt</span>
              <textarea
                aria-label="Diretriz da tarefa"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Descreva resultado esperado, contexto, limites e quando pedir aprovação…"
                rows={8}
                value={description}
              />
              <small>
                {description.length}/8000 · Não inclua segredos ou comandos
                vindos de e-mails.
              </small>
            </label>
            <label>
              <span>Responsável e workspace</span>
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
            <div className="kanban-create__summary">
              {laneId ? (
                <Bot aria-hidden="true" size={15} />
              ) : (
                <UserRound aria-hidden="true" size={15} />
              )}
              <span>
                {laneId
                  ? "O agente acompanha mudanças relevantes; nada externo é enviado sem aprovação."
                  : "A tarefa será sua e não acordará nenhum agente."}
              </span>
            </div>
            <footer>
              <Button
                className="kanban-modal__cancel"
                onPress={() => setCreating(false)}
                variant="ghost"
              >
                Cancelar
              </Button>
              <Button
                className="kanban-create__submit"
                isDisabled={!title.trim() || !description.trim()}
                type="submit"
              >
                <Plus aria-hidden="true" size={15} /> Criar tarefa
              </Button>
            </footer>
          </form>
        </div>
      )}

      {selected && confirmDelete && (
        <div
          className="kanban-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmDelete(false);
          }}
          role="presentation"
        >
          <section
            aria-label="Excluir tarefa"
            aria-modal="true"
            className="kanban-confirm"
            role="dialog"
          >
            <span className="kanban-confirm__icon">
              <Trash2 aria-hidden="true" size={19} />
            </span>
            <div>
              <span className="kanban-confirm__kicker">AÇÃO PERMANENTE</span>
              <h2>Excluir esta tarefa?</h2>
              <p>
                “{selected.title}” será removida do quadro. A origem vinculada
                não será apagada.
              </p>
            </div>
            <footer>
              <Button
                className="kanban-modal__cancel"
                onPress={() => setConfirmDelete(false)}
                variant="ghost"
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
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

function policyLabel(policy: KanbanCardContract["activationPolicy"]): string {
  if (policy === "status_transition") return "Acorda ao mover";
  if (policy === "relevant_change") return "Acorda se mudar";
  return "Execução manual";
}
