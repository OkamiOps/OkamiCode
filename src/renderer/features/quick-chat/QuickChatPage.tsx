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
  Bot,
  ChevronDown,
  MessageSquareText,
  Plus,
  Search,
  Send,
  ShieldCheck,
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
    send.error,
    promote.error,
  );
  const selectedCount = Object.keys(selectedMessageIds).length;
  const term = filter.trim().toLowerCase();
  const chats = (chatsQuery.data ?? []).filter((item) =>
    `${item.title} ${item.preview ?? ""}`.toLowerCase().includes(term),
  );

  return (
    <section aria-labelledby="quick-chat-heading" className="quick-chat-shell">
      <QuickChatHistory
        chats={chats}
        currentChatId={chatId}
        filter={filter}
        onFilter={setFilter}
        onNew={() => setSearchParams({ new: crypto.randomUUID() })}
        onSelect={(id) => setSearchParams({ chat: id })}
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
                  aria-label="Modelo do chat"
                  disabled={updateModel.isPending}
                  onChange={(event) => {
                    const option = modelOptions.find(
                      (candidate) => candidate.key === event.target.value,
                    );
                    if (!option) return;
                    setRuntime(option.runtime);
                    setModel(option.id);
                    setEffort(
                      option.runtime === "codex" ? DEFAULT_EFFORT : null,
                    );
                    if (chat) {
                      updateModel.mutate({
                        chatId: chat.id,
                        runtime: option.runtime,
                        model: option.id,
                      });
                    }
                  }}
                  value={`${activeRuntime}:${activeModel}`}
                >
                  {modelOptions.map((option) => (
                    <option key={option.key} value={option.key}>
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
    </section>
  );
}

function QuickChatHistory({
  chats,
  currentChatId,
  filter,
  onFilter,
  onNew,
  onSelect,
}: {
  chats: QuickChatSummary[];
  currentChatId: string | null;
  filter: string;
  onFilter: (value: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
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
      <nav aria-label="Conversas recentes">
        {chats.length === 0 ? (
          <p>Nenhuma conversa salva.</p>
        ) : (
          chats.map((chat) => (
            <button
              data-active={chat.id === currentChatId || undefined}
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              type="button"
            >
              <strong>{chat.title}</strong>
              <span>{chat.preview ?? modelDisplay(chat.model)}</span>
            </button>
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
  efforts?: string[];
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
          efforts: item.efforts,
        })),
  ) as ModelOption[];
  for (const fallback of [
    {
      key: "codex:gpt-5.6-luna",
      runtime: "codex" as const,
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna",
    },
    {
      key: "agy:gemini-3.5-flash",
      runtime: "agy" as const,
      id: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
    },
  ]) {
    if (!options.some((option) => option.key === fallback.key))
      options.unshift(fallback);
  }
  return options;
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
