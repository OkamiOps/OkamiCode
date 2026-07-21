import {
  Button,
  Checkbox,
  Chip,
  Label,
  Surface,
  TextArea,
  TextField,
} from "@heroui/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import {
  ArrowUpRight,
  Bot,
  MessageSquareText,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { ContextChips, type ContextChipItem } from "./ContextChips";
import { MemoryPicker } from "./MemoryPicker";

export interface QuickChatMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
}

type QuickChatCreateResult = IpcResponse<"quickChat:create">;
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
  send(request: {
    chatId: string;
    input: string;
    contextRefs: string[];
  }): Promise<QuickChatSendResult>;
  promote(request: {
    chatId: string;
    title: string;
    objective: string;
    selectedMessageIds: string[];
    contextRefs: string[];
  }): Promise<QuickChatPromotionResult>;
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
  removeChip: (ref: string) => void;
  setInput: (input: string) => void;
  toggleMessage: (id: string) => void;
}

const defaultQuickChatApi: QuickChatApi = {
  create: (request) => workbenchClient.quickChatCreate(request),
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
    return {
      ...response,
      task: { ...response.task, kind: "workbench" as const },
    };
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
  const chips = useStore(store, (state) => state.chips);
  const input = useStore(store, (state) => state.input);
  const messages = useStore(store, (state) => state.messages);
  const selectedMessageIds = useStore(
    store,
    (state) => state.selectedMessageIds,
  );
  const createStarted = useRef(false);
  const createChat = useMutation({ mutationFn: api.create });
  const send = useMutation({
    mutationFn: api.send,
    onSuccess: (result, request) => {
      store.getState().addMessage({
        id: result.messageId,
        role: "user",
        body: request.input,
      });
      store.getState().setInput("");
    },
  });
  const promote = useMutation({ mutationFn: api.promote });
  const chat = createChat.data;

  useEffect(() => {
    if (createStarted.current) return;
    createStarted.current = true;
    createChat.mutate({ runtime: "codex" });
  }, [createChat]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!chat || !trimmed || send.isPending) return;
    await send.mutateAsync({
      chatId: chat.id,
      input: trimmed,
      contextRefs: chips.map((chip) => chip.ref),
    });
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

  const error = firstError(createChat.error, send.error, promote.error);
  const selectedCount = Object.keys(selectedMessageIds).length;

  return (
    <section
      aria-labelledby="quick-chat-heading"
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
    >
      <header className="flex min-h-20 items-center justify-between gap-4 border-b border-[var(--ok-border)] bg-[var(--ok-surface-1)] px-4 sm:px-6">
        <div className="min-w-0">
          <p className="pane-kicker m-0">Conversa independente</p>
          <h1
            className="mt-1 truncate text-lg font-semibold tracking-[-0.025em]"
            id="quick-chat-heading"
          >
            Chat rápido
          </h1>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Chip
            className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok-text)]"
            size="sm"
            variant="secondary"
          >
            <Bot aria-hidden="true" className="mr-1 inline" size={11} />
            Codex
          </Chip>
          <Chip
            className="border border-[color-mix(in_srgb,var(--ok-green)_34%,var(--ok-border))] bg-[var(--ok-bg)] text-[var(--ok-green)]"
            size="sm"
            variant="secondary"
          >
            <ShieldCheck aria-hidden="true" className="mr-1 inline" size={11} />
            Sem workspace
          </Chip>
        </div>
      </header>

      <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
        {messages.length === 0 ? (
          <div className="grid min-h-full place-content-center justify-items-center text-center">
            <span className="grid size-11 place-items-center rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-1)] text-[var(--ok-orange)]">
              <MessageSquareText aria-hidden="true" size={19} />
            </span>
            <h2 className="mt-3 text-sm font-semibold">Conversa limpa</h2>
            <p className="mt-1 max-w-md text-xs leading-5 text-[var(--ok-text-muted)]">
              Nenhum histórico ou arquivo de projeto entra aqui. Adicione apenas
              o contexto necessário e remova qualquer chip antes de enviar.
            </p>
          </div>
        ) : (
          <div
            aria-label="Mensagens do chat rápido"
            aria-live="polite"
            className="mx-auto grid w-full max-w-3xl gap-3"
          >
            {messages.map((message) => (
              <Surface
                className={`flex max-w-[88%] items-start gap-2 rounded-[var(--ok-radius-md)] border px-3 py-2.5 text-sm leading-6 ${
                  message.role === "user"
                    ? "ml-auto border-[color-mix(in_srgb,var(--ok-orange)_36%,var(--ok-border))] bg-[color-mix(in_srgb,var(--ok-orange)_12%,var(--ok-surface-2))]"
                    : "mr-auto border-[var(--ok-border)] bg-[var(--ok-surface-1)]"
                }`}
                key={message.id}
                variant="secondary"
              >
                <Checkbox
                  aria-label={`Incluir na promoção: ${message.body}`}
                  className="mt-1 shrink-0"
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
                <p className="m-0 min-w-0">{message.body}</p>
              </Surface>
            ))}
          </div>
        )}
      </div>

      <form
        className="border-t border-[var(--ok-border)] bg-[var(--ok-surface-1)] p-3 sm:px-5"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <div className="min-w-0">
              <ContextChips
                chips={chips}
                onRemove={(ref) => store.getState().removeChip(ref)}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <MemoryPicker
                onSelect={(chip) => store.getState().addChip(chip)}
              />
              <Button
                className="border border-[var(--ok-border)] text-[var(--ok-text-muted)]"
                isDisabled={!chat || selectedCount === 0 || promote.isPending}
                size="sm"
                type="button"
                variant="ghost"
                onPress={() => void handlePromote()}
              >
                <ArrowUpRight aria-hidden="true" size={13} />
                Promover para tarefa
              </Button>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <TextField className="min-w-0 flex-1" fullWidth>
              <Label className="sr-only">Mensagem rápida</Label>
              <TextArea
                className="max-h-40 min-h-11 w-full resize-none rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-bg)] px-3 py-2.5 text-sm text-[var(--ok-text)] outline-none placeholder:text-[var(--ok-text-muted)] focus:border-[var(--ok-cyan)]"
                disabled={!chat || send.isPending}
                placeholder="Pergunte sem carregar um projeto…"
                rows={2}
                value={input}
                onChange={(event) =>
                  store.getState().setInput(event.target.value)
                }
              />
            </TextField>
            <Button
              className="h-11 bg-[var(--ok-orange)] font-semibold text-[var(--ok-bg)]"
              isDisabled={!chat || !input.trim() || send.isPending}
              type="submit"
              variant="primary"
            >
              <Send aria-hidden="true" size={14} />
              Enviar
            </Button>
          </div>
          {error && (
            <p className="mt-2 text-[11px] text-[var(--ok-red)]" role="alert">
              {error.message}
            </p>
          )}
          {promote.data && (
            <p
              className="mt-2 text-[11px] text-[var(--ok-green)]"
              role="status"
            >
              Tarefa criada apenas com a seleção atual.
            </p>
          )}
        </div>
      </form>
    </section>
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
        messages: [...state.messages, message],
        selectedMessageIds: {
          ...state.selectedMessageIds,
          [message.id]: true,
        },
      })),
    addChip: (chip) =>
      set((state) => ({
        chips: state.chips.some((current) => current.ref === chip.ref)
          ? state.chips
          : [...state.chips, chip],
      })),
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
  }));
}

function firstError(...errors: unknown[]): Error | null {
  return errors.find((error): error is Error => error instanceof Error) ?? null;
}
