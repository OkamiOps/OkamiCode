import { Button, Checkbox, Surface } from "@heroui/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowUpDown,
  Bot,
  ChevronDown,
  MoreHorizontal,
  MessageSquareText,
  Palette,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { RuntimeKind } from "../../../shared/contracts/lane";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { subscribeToWorkbenchEvents } from "../../lib/ipc/events";
import { ContextChips, type ContextChipItem } from "./ContextChips";
import { MemoryPicker } from "./MemoryPicker";

const DEFAULT_RUNTIME = "codex" as const;
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_EFFORT = "high";

export interface QuickChatMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  createdAt?: string;
}

type QuickChatCreateResult = IpcResponse<"quickChat:create">;
type QuickChatSummary = IpcResponse<"quickChat:list">[number];
type QuickChatSendResult = Extract<
  IpcResponse<"quickChat:send">,
  { runId: string }
>;
type PromotionResponse = Extract<
  IpcResponse<"quickChat:send">,
  { task: unknown }
>;
type QuickChatPromotionResult = Omit<PromotionResponse, "task"> & {
  task: PromotionResponse["task"] & { kind: "workbench" };
};

export interface QuickChatApi {
  create(
    request: IpcRequest<"quickChat:create">,
  ): Promise<QuickChatCreateResult>;
  list(): Promise<IpcResponse<"quickChat:list">>;
  get(
    request: IpcRequest<"quickChat:get">,
  ): Promise<IpcResponse<"quickChat:get">>;
  models(): Promise<IpcResponse<"models:list">>;
  updateModel(
    request: IpcRequest<"quickChat:updateModel">,
  ): Promise<IpcResponse<"quickChat:updateModel">>;
  rename(
    request: IpcRequest<"task:rename">,
  ): Promise<IpcResponse<"task:rename">>;
  delete(
    request: IpcRequest<"task:delete">,
  ): Promise<IpcResponse<"task:delete">>;
  send(request: {
    chatId: string;
    input: string;
    contextRefs: string[];
    effort?: string;
  }): Promise<QuickChatSendResult>;
  promote(request: {
    chatId: string;
    title: string;
    objective: string;
    selectedMessageIds: string[];
    contextRefs: string[];
  }): Promise<QuickChatPromotionResult>;
  subscribe?(listener: (event: CanonicalEvent) => void): () => void;
}

interface QuickChatPageProps {
  api?: QuickChatApi;
  initialChips?: ContextChipItem[];
  initialMessages?: QuickChatMessage[];
}

interface QuickChatUiState {
  chips: ContextChipItem[];
  input: string;
  messages: QuickChatMessage[];
  selectedMessageIds: Record<string, true>;
  addMessage: (message: QuickChatMessage) => void;
  addChip: (chip: ContextChipItem) => void;
  hydrate: (messages: QuickChatMessage[]) => void;
  removeChip: (ref: string) => void;
  setInput: (input: string) => void;
  toggleMessage: (id: string) => void;
  upsertAssistant: (id: string, text: string, replace?: boolean) => void;
}

const defaultQuickChatApi: QuickChatApi = {
  create: (request) => workbenchClient.quickChatCreate(request),
  list: () => workbenchClient.quickChatList(),
  get: (request) => workbenchClient.quickChatGet(request),
  models: () => workbenchClient.modelsList(),
  updateModel: (request) => workbenchClient.quickChatUpdateModel(request),
  rename: (request) => workbenchClient.taskRename(request),
  delete: (request) => workbenchClient.taskDelete(request),
  subscribe: subscribeToWorkbenchEvents,
  send: async (request) => {
    const response = await workbenchClient.quickChatSend(request);
    if (!("runId" in response)) {
      throw new Error("Resposta de envio do chat rápido inválida");
    }
    return response;
  },
  promote: async (request) => {
    const response = await workbenchClient.quickChatSend({
      chatId: request.chatId,
      promotion: {
        title: request.title,
        objective: request.objective,
        selectedMessageIds: request.selectedMessageIds,
        contextRefs: request.contextRefs,
      },
    });
    if (!("task" in response) || response.task.kind !== "workbench") {
      throw new Error("Resposta de promoção do chat rápido inválida");
    }
    return { ...response, task: { ...response.task, kind: "workbench" } };
  },
};

export function QuickChatPage({
  api = defaultQuickChatApi,
  initialChips = [],
  initialMessages = [],
}: QuickChatPageProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { retry: false, staleTime: 5_000 },
        },
      }),
  );
  const [store] = useState(() =>
    createQuickChatStore(initialChips, initialMessages),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <QuickChatContent api={api} store={store} />
    </QueryClientProvider>
  );
}

function QuickChatContent({
  api,
  store,
}: {
  api: QuickChatApi;
  store: StoreApi<QuickChatUiState>;
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const chatId = searchParams.get("chat");
  const chips = useStore(store, (state) => state.chips);
  const input = useStore(store, (state) => state.input);
  const messages = useStore(store, (state) => state.messages);
  const selectedMessageIds = useStore(
    store,
    (state) => state.selectedMessageIds,
  );
  const [filter, setFilter] = useState("");
  const [conversationColors, setConversationColors] = useState(
    readConversationColors,
  );
  const [historyPreferences, setHistoryPreferences] = useState(
    readHistoryPreferences,
  );
  const [editingChat, setEditingChat] = useState<QuickChatSummary | null>(null);
  const [runtime, setRuntime] =
    useState<Exclude<RuntimeKind, "cursor">>(DEFAULT_RUNTIME);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState<string | null>(DEFAULT_EFFORT);
  const chatsQuery = useQuery({
    queryKey: ["quick-chat", "list"],
    queryFn: api.list,
  });
  const historyQuery = useQuery({
    queryKey: ["quick-chat", "history", chatId],
    queryFn: () => api.get({ chatId: chatId! }),
    enabled: Boolean(chatId),
  });
  const modelsQuery = useQuery({
    queryKey: ["quick-chat", "models"],
    queryFn: api.models,
  });
  const createChat = useMutation({
    mutationFn: api.create,
  });
  const updateModel = useMutation({
    mutationFn: api.updateModel,
    onSuccess: (updated) => {
      setRuntime(updated.runtime as Exclude<RuntimeKind, "cursor">);
      setModel(updated.model);
      void queryClient.invalidateQueries({
        queryKey: ["quick-chat", "history", updated.id],
      });
      void queryClient.invalidateQueries({ queryKey: ["quick-chat", "list"] });
    },
  });
  const renameChat = useMutation({
    mutationFn: api.rename,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["quick-chat", "list"] }),
  });
  const deleteChat = useMutation({
    mutationFn: api.delete,
    onSuccess: (_result, request) => {
      if (editingChat) {
        const next = { ...conversationColors };
        delete next[editingChat.id];
        setConversationColors(next);
        localStorage.setItem(conversationColorStorageKey, JSON.stringify(next));
      }
      if (editingChat?.taskId === request.taskId) setEditingChat(null);
      if (historyQuery.data?.taskId === request.taskId) {
        store.getState().hydrate([]);
        setSearchParams({ new: crypto.randomUUID() }, { replace: true });
      }
      void queryClient.invalidateQueries({ queryKey: ["quick-chat", "list"] });
    },
  });
  const send = useMutation({
    mutationFn: api.send,
    onSuccess: (result, request) => {
      store.getState().addMessage({
        id: result.messageId,
        role: "user",
        body: request.input,
      });
      store.getState().setInput("");
      void queryClient.invalidateQueries({ queryKey: ["quick-chat", "list"] });
    },
  });
  const promote = useMutation({ mutationFn: api.promote });

  useEffect(() => {
    const history = historyQuery.data;
    if (!history) return;
    store.getState().hydrate(history.messages);
  }, [historyQuery.data, store]);

  useEffect(() => {
    if (!api.subscribe || !chatId) return;
    return api.subscribe((event) => {
      const activeLane = historyQuery.data?.laneId ?? createChat.data?.laneId;
      if (!activeLane || event.laneId !== activeLane) return;
      if (event.kind === "message_delta") {
        const delta = event.payload.delta;
        if (typeof delta === "string") {
          store.getState().upsertAssistant(`assistant:${event.runId}`, delta);
        }
      }
      if (event.kind === "message_completed") {
        const text = event.payload.text;
        if (typeof text === "string" && text.trim()) {
          store
            .getState()
            .upsertAssistant(`assistant:${event.runId}`, text, true);
        }
        void queryClient.invalidateQueries({
          queryKey: ["quick-chat", "history", chatId],
        });
        void queryClient.invalidateQueries({
          queryKey: ["quick-chat", "list"],
        });
      }
    });
  }, [
    api,
    chatId,
    createChat.data?.laneId,
    historyQuery.data?.laneId,
    queryClient,
    store,
  ]);

  const chat = historyQuery.data ?? createChat.data;
  const modelOptions = useMemo(
    () => availableModels(modelsQuery.data ?? []),
    [modelsQuery.data],
  );
  const localModelSelection = updateModel.isPending || updateModel.data;
  const activeRuntime = localModelSelection
    ? runtime
    : ((historyQuery.data?.runtime as Exclude<RuntimeKind, "cursor">) ??
      runtime);
  const activeModel = localModelSelection
    ? model
    : (historyQuery.data?.model ?? model);
  const selectedDefinition = modelOptions.find(
    (option) => option.runtime === activeRuntime && option.id === activeModel,
  );
  const efforts =
    selectedDefinition?.efforts ??
    (activeRuntime === "codex" ? ["low", "medium", "high", "xhigh"] : []);
  const providerOptions = providersFor(modelOptions);
  const providerModels = modelOptions.filter(
    (option) => option.runtime === activeRuntime,
  );

  function chooseModel(option: ModelOption) {
    setRuntime(option.runtime);
    setModel(option.id);
    setEffort(
      option.defaultEffort ??
        (option.runtime === "codex" ? DEFAULT_EFFORT : null),
    );
    if (chat)
      updateModel.mutate({
        chatId: chat.id,
        runtime: option.runtime,
        model: option.id,
      });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || createChat.isPending || send.isPending) return;
    const targetChat =
      chat ??
      (await createChat.mutateAsync({
        runtime: activeRuntime,
        model: activeModel,
      }));
    await send.mutateAsync({
      chatId: targetChat.id,
      input: trimmed,
      contextRefs: chips.map((chip) => chip.ref),
      ...(activeRuntime === "codex" && effort ? { effort } : {}),
    });
    if (!chat) {
      setSearchParams({ chat: targetChat.id }, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ["quick-chat", "list"] });
    }
  }

  async function handlePromote() {
    if (!chat || promote.isPending) return;
    const selected = messages.filter(
      (message) => selectedMessageIds[message.id],
    );
    if (selected.length === 0) return;
    await promote.mutateAsync({
      chatId: chat.id,
      title: "Tarefa promovida do chat rápido",
      objective: selected.map((message) => message.body).join("\n\n"),
      selectedMessageIds: selected.map((message) => message.id),
      contextRefs: chips.map((chip) => chip.ref),
    });
  }

  const error = firstError(
    createChat.error,
    historyQuery.error,
    updateModel.error,
    renameChat.error,
    deleteChat.error,
    send.error,
    promote.error,
  );
  const selectedCount = Object.keys(selectedMessageIds).length;
  const term = filter.trim().toLowerCase();
  const chats = (chatsQuery.data ?? [])
    .filter((item) =>
      `${item.title} ${item.preview ?? ""}`.toLowerCase().includes(term),
    )
    .sort((left, right) => {
      const pinned =
        Number(historyPreferences.pinned.includes(right.id)) -
        Number(historyPreferences.pinned.includes(left.id));
      if (pinned) return pinned;
      if (historyPreferences.sort === "name")
        return left.title.localeCompare(right.title, "pt-BR");
      if (historyPreferences.sort === "oldest")
        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });

  function saveHistoryPreferences(next: HistoryPreferences) {
    setHistoryPreferences(next);
    localStorage.setItem(historyPreferencesKey, JSON.stringify(next));
  }

  return (
    <section aria-labelledby="quick-chat-heading" className="quick-chat-shell">
      <QuickChatHistory
        chats={chats}
        currentChatId={chatId}
        filter={filter}
        colors={conversationColors}
        preferences={historyPreferences}
        onFilter={setFilter}
        onNew={() => setSearchParams({ new: crypto.randomUUID() })}
        onSelect={(id) => setSearchParams({ chat: id })}
        onManage={setEditingChat}
        onSort={(sort) =>
          saveHistoryPreferences({ ...historyPreferences, sort })
        }
      />

      <div className="quick-chat-main">
        <header className="quick-chat-header">
          <div>
            <p className="pane-kicker">Conversa independente</p>
            <h1 id="quick-chat-heading">
              {historyQuery.data?.title ?? "Chat rápido"}
            </h1>
          </div>
          <span className="quick-chat-workspace-badge">
            <ShieldCheck aria-hidden="true" size={12} /> Sem workspace
          </span>
        </header>

        <div className="quick-chat-messages">
          {messages.length === 0 ? (
            <div className="quick-chat-empty">
              <span>
                <MessageSquareText aria-hidden="true" size={20} />
              </span>
              <h2>Pode perguntar direto</h2>
              <p>
                Este chat não carrega pasta, projeto ou memória automaticamente.
                Contexto é opcional — digite normalmente para começar.
              </p>
            </div>
          ) : (
            <div
              aria-label="Mensagens do chat rápido"
              aria-live="polite"
              className="quick-chat-thread"
            >
              {messages.map((message) => (
                <Surface
                  className={`quick-chat-message quick-chat-message--${message.role}`}
                  key={message.id}
                  variant="secondary"
                >
                  <Checkbox
                    aria-label={`Incluir na promoção: ${message.body}`}
                    className="quick-chat-message__select"
                    isSelected={Boolean(selectedMessageIds[message.id])}
                    onChange={() => store.getState().toggleMessage(message.id)}
                  >
                    <Checkbox.Content
                      aria-label={`Incluir na promoção: ${message.body}`}
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>
                  <p>{message.body}</p>
                </Surface>
              ))}
            </div>
          )}
        </div>

        <form
          className="quick-chat-composer"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="quick-chat-composer__context">
            <ContextChips
              chips={chips}
              onRemove={(ref) => store.getState().removeChip(ref)}
            />
            <div>
              <MemoryPicker
                onSelect={(chip) => store.getState().addChip(chip)}
              />
              <Button
                aria-label="Promover para tarefa"
                className="quick-chat-promote"
                isDisabled={!chat || selectedCount === 0 || promote.isPending}
                size="sm"
                type="button"
                variant="ghost"
                onPress={() => void handlePromote()}
              >
                <ArrowUpRight aria-hidden="true" size={13} /> Promover
              </Button>
            </div>
          </div>
          <div className="quick-chat-composer__box">
            <textarea
              aria-label="Mensagem rápida"
              disabled={send.isPending}
              onChange={(event) =>
                store.getState().setInput(event.target.value)
              }
              placeholder="Pergunte qualquer coisa…"
              rows={2}
              value={input}
            />
            <div className="quick-chat-composer__toolbar">
              <span className="quick-chat-model-select">
                <Bot aria-hidden="true" size={13} />
                <select
                  aria-label="Provider do chat"
                  disabled={updateModel.isPending}
                  onChange={(event) => {
                    const provider = providerOptions.find(
                      (candidate) => candidate.runtime === event.target.value,
                    );
                    const option =
                      provider &&
                      modelOptions.find(
                        (candidate) => candidate.runtime === provider.runtime,
                      );
                    if (option) chooseModel(option);
                  }}
                  value={activeRuntime}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.runtime} value={provider.runtime}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={12} />
              </span>
              <span className="quick-chat-model-select quick-chat-model-select--model">
                <select
                  aria-label="Modelo do chat"
                  disabled={updateModel.isPending}
                  onChange={(event) => {
                    const option = providerModels.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    if (option) chooseModel(option);
                  }}
                  value={activeModel}
                >
                  {providerModels.map((option) => (
                    <option key={option.key} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={12} />
              </span>
              {efforts.length > 0 && (
                <span className="quick-chat-effort-select">
                  <select
                    aria-label="Nível de esforço"
                    onChange={(event) => setEffort(event.target.value)}
                    value={effort ?? ""}
                  >
                    {efforts.map((item) => (
                      <option key={item} value={item}>
                        {effortLabel(item)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" size={12} />
                </span>
              )}
              <span className="quick-chat-composer__spacer" />
              <button
                aria-label="Enviar"
                className="quick-chat-send"
                disabled={
                  !input.trim() || createChat.isPending || send.isPending
                }
                type="submit"
              >
                <Send aria-hidden="true" size={15} />
              </button>
            </div>
          </div>
          {(createChat.isPending || send.isPending) && (
            <p className="quick-chat-status">
              {createChat.isPending
                ? "Criando a conversa…"
                : "Enviando sua mensagem…"}
            </p>
          )}
          {error && (
            <div className="quick-chat-error" role="alert">
              <span>{error.message}</span>
            </div>
          )}
        </form>
      </div>
      {editingChat && (
        <ConversationDialog
          chat={editingChat}
          color={conversationColors[editingChat.id] ?? "orange"}
          pinned={historyPreferences.pinned.includes(editingChat.id)}
          deleting={deleteChat.isPending}
          renaming={renameChat.isPending}
          onClose={() => setEditingChat(null)}
          onDelete={() => deleteChat.mutate({ taskId: editingChat.taskId })}
          onSave={async (title, color, pinned) => {
            if (title.trim() !== editingChat.title) {
              await renameChat.mutateAsync({
                taskId: editingChat.taskId,
                title: title.trim(),
              });
            }
            const next = { ...conversationColors, [editingChat.id]: color };
            setConversationColors(next);
            localStorage.setItem(
              conversationColorStorageKey,
              JSON.stringify(next),
            );
            saveHistoryPreferences({
              ...historyPreferences,
              pinned: pinned
                ? [
                    editingChat.id,
                    ...historyPreferences.pinned.filter(
                      (id) => id !== editingChat.id,
                    ),
                  ]
                : historyPreferences.pinned.filter(
                    (id) => id !== editingChat.id,
                  ),
            });
            setEditingChat(null);
          }}
        />
      )}
    </section>
  );
}

function QuickChatHistory({
  chats,
  currentChatId,
  filter,
  colors,
  preferences,
  onFilter,
  onNew,
  onSelect,
  onManage,
  onSort,
}: {
  chats: QuickChatSummary[];
  currentChatId: string | null;
  filter: string;
  colors: Record<string, ConversationColor>;
  preferences: HistoryPreferences;
  onFilter: (value: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onManage: (chat: QuickChatSummary) => void;
  onSort: (sort: HistorySort) => void;
}) {
  return (
    <aside aria-label="Histórico de chats" className="quick-chat-history">
      <header>
        <span className="pane-kicker">Chat</span>
        <h2>Conversas</h2>
      </header>
      <button className="quick-chat-history__new" onClick={onNew} type="button">
        <Plus aria-hidden="true" size={15} /> Nova conversa
      </button>
      <label className="quick-chat-history__search">
        <Search aria-hidden="true" size={13} />
        <input
          aria-label="Buscar chats"
          onChange={(event) => onFilter(event.target.value)}
          placeholder="Buscar chats"
          type="search"
          value={filter}
        />
      </label>
      <label className="quick-chat-history__sort">
        <ArrowUpDown aria-hidden="true" size={12} />
        <select
          aria-label="Ordenar conversas"
          onChange={(event) => onSort(event.target.value as HistorySort)}
          value={preferences.sort}
        >
          <option value="recent">Mais recentes</option>
          <option value="oldest">Mais antigas</option>
          <option value="name">Nome</option>
        </select>
      </label>
      <nav aria-label="Conversas recentes">
        {chats.length === 0 ? (
          <p>Nenhuma conversa salva.</p>
        ) : (
          chats.map((chat) => (
            <div
              className="quick-chat-history__item"
              data-active={chat.id === currentChatId || undefined}
              data-color={colors[chat.id] ?? "orange"}
              key={chat.id}
            >
              <button
                className="quick-chat-history__open"
                onClick={() => onSelect(chat.id)}
                type="button"
              >
                <strong>
                  {preferences.pinned.includes(chat.id) && (
                    <Pin aria-label="Fixada" size={10} />
                  )}
                  {chat.title}
                </strong>
                <span>{chat.preview ?? modelDisplay(chat.model)}</span>
              </button>
              <button
                aria-label={`Opções de ${chat.title}`}
                className="quick-chat-history__more"
                onClick={() => onManage(chat)}
                type="button"
              >
                <MoreHorizontal aria-hidden="true" size={15} />
              </button>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}

interface ModelOption {
  key: string;
  runtime: "claude" | "codex" | "agy";
  id: string;
  label: string;
  providerLabel: string;
  efforts?: string[];
  defaultEffort?: string;
}

function availableModels(catalog: IpcResponse<"models:list">): ModelOption[] {
  const options = catalog.flatMap((provider) =>
    provider.runtimeKind === "cursor"
      ? []
      : provider.models.map((item) => ({
          key: `${provider.runtimeKind}:${item.id}`,
          runtime: provider.runtimeKind,
          id: item.id,
          label: item.label,
          providerLabel: provider.providerLabel,
          efforts: item.efforts,
          defaultEffort: item.defaultEffort,
        })),
  ) as ModelOption[];
  for (const fallback of [
    {
      key: "codex:gpt-5.6-luna",
      runtime: "codex" as const,
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
      providerLabel: "Codex",
    },
    {
      key: "agy:gemini-3.5-flash",
      runtime: "agy" as const,
      id: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
      providerLabel: "Antigravity",
    },
  ]) {
    if (!options.some((option) => option.key === fallback.key))
      options.unshift(fallback);
  }
  return options;
}

function providersFor(options: ModelOption[]) {
  return [
    ...new Map(
      options.map((option) => [
        option.runtime,
        { runtime: option.runtime, label: option.providerLabel },
      ]),
    ).values(),
  ];
}

const conversationColorStorageKey = "okami.quick-chat.colors";
const historyPreferencesKey = "okami.quick-chat.history-preferences";
const conversationColors = [
  "orange",
  "cyan",
  "violet",
  "green",
  "rose",
  "amber",
] as const;
type ConversationColor = (typeof conversationColors)[number];
type HistorySort = "recent" | "oldest" | "name";
interface HistoryPreferences {
  sort: HistorySort;
  pinned: string[];
}

function readHistoryPreferences(): HistoryPreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(historyPreferencesKey) ?? "null",
    ) as Partial<HistoryPreferences> | null;
    return {
      sort: ["recent", "oldest", "name"].includes(value?.sort ?? "")
        ? value!.sort!
        : "recent",
      pinned: Array.isArray(value?.pinned)
        ? value.pinned.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { sort: "recent", pinned: [] };
  }
}

function readConversationColors(): Record<string, ConversationColor> {
  try {
    const value = JSON.parse(
      localStorage.getItem(conversationColorStorageKey) ?? "{}",
    ) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, ConversationColor] =>
          conversationColors.includes(entry[1] as ConversationColor),
      ),
    );
  } catch {
    return {};
  }
}

function ConversationDialog({
  chat,
  color,
  pinned,
  deleting,
  onClose,
  onDelete,
  onSave,
  renaming,
}: {
  chat: QuickChatSummary;
  color: ConversationColor;
  pinned: boolean;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: (
    title: string,
    color: ConversationColor,
    pinned: boolean,
  ) => Promise<void>;
  renaming: boolean;
}) {
  const [title, setTitle] = useState(chat.title);
  const [selectedColor, setSelectedColor] = useState(color);
  const [isPinned, setIsPinned] = useState(pinned);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="ok-modal-backdrop" role="presentation">
      <section
        aria-labelledby="conversation-dialog-heading"
        aria-modal="true"
        className="quick-chat-dialog"
        role="dialog"
      >
        <header>
          <span>
            <Palette aria-hidden="true" size={17} />
          </span>
          <div>
            <p className="pane-kicker">Organizar conversa</p>
            <h2 id="conversation-dialog-heading">Detalhes do chat</h2>
          </div>
          <button aria-label="Fechar" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        {confirmDelete ? (
          <div className="quick-chat-dialog__danger">
            <Trash2 aria-hidden="true" size={20} />
            <h3>Excluir esta conversa?</h3>
            <p>
              Ela sairá do histórico. Esta ação não apaga projetos ou arquivos.
            </p>
            <footer>
              <Button variant="ghost" onPress={() => setConfirmDelete(false)}>
                Voltar
              </Button>
              <Button
                className="quick-chat-dialog__delete"
                isDisabled={deleting}
                onPress={onDelete}
              >
                {deleting ? "Excluindo…" : "Excluir conversa"}
              </Button>
            </footer>
          </div>
        ) : (
          <>
            <label className="quick-chat-dialog__title">
              <span>
                <Pencil aria-hidden="true" size={12} /> Nome
              </span>
              <input
                maxLength={240}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <fieldset>
              <legend>Cor no histórico</legend>
              <div className="quick-chat-dialog__colors">
                {conversationColors.map((item) => (
                  <button
                    aria-label={`Cor ${item}`}
                    aria-pressed={selectedColor === item}
                    data-color={item}
                    key={item}
                    onClick={() => setSelectedColor(item)}
                    type="button"
                  />
                ))}
              </div>
            </fieldset>
            <label className="quick-chat-dialog__pin">
              <input
                checked={isPinned}
                onChange={(event) => setIsPinned(event.target.checked)}
                type="checkbox"
              />
              <Pin aria-hidden="true" size={13} /> Fixar no topo do histórico
            </label>
            <footer>
              <Button
                className="quick-chat-dialog__trash"
                variant="ghost"
                onPress={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" size={13} /> Excluir
              </Button>
              <span />
              <Button variant="ghost" onPress={onClose}>
                Cancelar
              </Button>
              <Button
                className="quick-chat-dialog__save"
                isDisabled={!title.trim() || renaming}
                onPress={() => void onSave(title, selectedColor, isPinned)}
              >
                Salvar
              </Button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function modelDisplay(model: string): string {
  return model
    .replaceAll("-", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function effortLabel(effort: string): string {
  return (
    (
      {
        low: "Baixo",
        medium: "Médio",
        high: "Alto",
        xhigh: "Extra alto",
      } as Record<string, string>
    )[effort] ?? effort
  );
}

function createQuickChatStore(
  chips: ContextChipItem[],
  messages: QuickChatMessage[],
): StoreApi<QuickChatUiState> {
  return createStore<QuickChatUiState>((set) => ({
    chips,
    input: "",
    messages,
    selectedMessageIds: Object.fromEntries(
      messages.map((message) => [message.id, true as const]),
    ),
    addMessage: (message) =>
      set((state) => ({
        messages: [
          ...state.messages.filter((current) => current.id !== message.id),
          message,
        ],
        selectedMessageIds: { ...state.selectedMessageIds, [message.id]: true },
      })),
    addChip: (chip) =>
      set((state) => ({
        chips: state.chips.some((current) => current.ref === chip.ref)
          ? state.chips
          : [...state.chips, chip],
      })),
    hydrate: (next) =>
      set({
        messages: next,
        selectedMessageIds: Object.fromEntries(
          next.map((message) => [message.id, true as const]),
        ),
      }),
    removeChip: (ref) =>
      set((state) => ({
        chips: state.chips.filter((chip) => chip.ref !== ref),
      })),
    setInput: (input) => set({ input }),
    toggleMessage: (id) =>
      set((state) => {
        const selectedMessageIds = { ...state.selectedMessageIds };
        if (selectedMessageIds[id]) delete selectedMessageIds[id];
        else selectedMessageIds[id] = true;
        return { selectedMessageIds };
      }),
    upsertAssistant: (id, text, replace = false) =>
      set((state) => {
        const current = state.messages.find((message) => message.id === id);
        const next = {
          id,
          role: "assistant" as const,
          body: replace ? text : `${current?.body ?? ""}${text}`,
        };
        return {
          messages: current
            ? state.messages.map((message) =>
                message.id === id ? next : message,
              )
            : [...state.messages, next],
        };
      }),
  }));
}

function firstError(...errors: unknown[]): Error | null {
  return errors.find((error): error is Error => error instanceof Error) ?? null;
}
