import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import {
  InboxPage,
  projectLocallyReadThreads,
  type InboxApi,
} from "./InboxPage";

const accountId = "11111111-1111-4111-8111-111111111111";
const threadId = "22222222-2222-4222-8222-222222222222";
const now = "2026-07-21T09:30:00.000Z";
const remoteImageTrustKey = "okami.inbox.remoteImages.allowedSenders.v1";

const account: IpcResponse<"inbox:accounts:list">[number] = {
  account: {
    id: accountId,
    provider: "imap",
    displayName: "Projetos",
    address: "contato@okamiops.com",
    status: "connected",
    syncCursor: null,
    lastError: null,
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  },
  configuration: {
    host: "imap.okamiops.com",
    port: 993,
    secure: true,
    mailbox: "INBOX",
    maxInitialMessages: 100,
    maxMessageBytes: 2_097_152,
  },
  hasCredential: true,
};

const thread: IpcResponse<"inbox:threads:list">["threads"][number] = {
  id: threadId,
  accountId,
  externalThreadId: "message-12",
  subject: "Proposta para landing page",
  snippet: "Pode nos enviar uma proposta para o novo site?",
  participants: ["Ana Silva <ana@cliente.com>", "contato@okamiops.com"],
  unreadCount: 1,
  lastMessageAt: now,
  labels: ["Cliente"],
  folder: "inbox",
  createdAt: now,
  updatedAt: now,
};
const secondThread: IpcResponse<"inbox:threads:list">["threads"][number] = {
  ...thread,
  id: "44444444-4444-4444-8444-444444444444",
  externalThreadId: "message-13",
  subject: "Revisão do contrato",
  snippet: "Pode revisar o contrato antes da reunião?",
  participants: ["Bruno <bruno@cliente.com>", "contato@okamiops.com"],
  unreadCount: 0,
};

const workspaceLane: IpcResponse<"lane:list">[number] = {
  laneId: "55555555-5555-4555-8555-555555555555",
  taskId: "66666666-6666-4666-8666-666666666666",
  harness: "claude",
  runtimeKind: "claude",
  runtimeVersion: "2.1.0",
  providerAccountLabel: "Anthropic Max",
  model: "Claude Sonnet 4.5",
  routeKind: "direct",
  routeReason: "Assinatura local",
  displayQuotaAccount: "Max",
  permissionMode: "ask",
  workspacePath: "/Users/marcos/Projetos/landing",
  nativeSessionIdPrefix: null,
  status: "ready",
  temperature: "clean",
  pendingDeltaEvents: 0,
};

const taskResult = {
  sourceThreadId: threadId,
  executionStarted: false,
} as IpcResponse<"inbox:thread:createTask">;

const replyDraftResult = {
  id: "77777777-7777-4777-8777-777777777777",
  sourceThreadId: threadId,
  connectorAccountId: accountId,
  fromAddress: "contato@okamiops.com",
  messageType: "reply",
  to: ["Ana Silva <ana@cliente.com>"],
  subject: "Re: Proposta para landing page",
  body: "Obrigado pela mensagem.",
  status: "approval_pending",
  requiresApproval: true,
  safeRetry: false,
  attempts: 0,
  createdAt: now,
  updatedAt: now,
} as IpcResponse<"inbox:thread:createReplyDraft">;

const forwardDraftResult = {
  ...replyDraftResult,
  id: "99999999-9999-4999-8999-999999999999",
  messageType: "forward",
  to: ["propostas@cliente.com"],
  subject: "Enc: Proposta para landing page",
  body: "Segue para análise.\n\n---------- Mensagem encaminhada ----------",
} as IpcResponse<"inbox:thread:createForwardDraft">;

const replyAction = {
  ...replyDraftResult,
  approvedAt: null,
  lastError: null,
} as IpcResponse<"inbox:thread:replyActions:list">[number];

const replyModels = [
  {
    runtimeKind: "codex" as const,
    providerLabel: "ChatGPT Plus",
    routeKind: "direct" as const,
    source: "subscription",
    models: [
      {
        id: "gpt-5.6",
        label: "GPT-5.6",
        description: "Rascunhos cuidadosos",
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
      },
      { id: "gpt-5.6-mini", label: "GPT-5.6 mini" },
    ],
  },
  {
    runtimeKind: "agy" as const,
    providerLabel: "Antigravity",
    routeKind: "native" as const,
    source: "subscription",
    models: [
      {
        id: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        efforts: ["low", "high"],
        defaultEffort: "high",
      },
    ],
  },
  {
    runtimeKind: "grok" as const,
    providerLabel: "Grok",
    routeKind: "native" as const,
    source: "subscription",
    models: [{ id: "grok-4.5", label: "Grok 4.5" }],
  },
  {
    runtimeKind: "mimo" as const,
    providerLabel: "MiMo",
    routeKind: "native" as const,
    source: "subscription",
    models: [{ id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" }],
  },
  {
    runtimeKind: "minimax" as const,
    providerLabel: "MiniMax",
    routeKind: "native" as const,
    source: "subscription",
    models: [{ id: "minimax-m2.7", label: "MiniMax M2.7" }],
  },
  {
    runtimeKind: "claude" as const,
    providerLabel: "Claude Max",
    routeKind: "unavailable" as const,
    source: "subscription",
    models: [{ id: "claude-hidden", label: "Não deve aparecer" }],
  },
] satisfies IpcResponse<"models:list">;

function makeApi(overrides: Partial<InboxApi> = {}): InboxApi {
  return {
    listAccounts: vi.fn().mockResolvedValue([account]),
    addAccount: vi.fn().mockResolvedValue(account),
    removeAccount: vi.fn().mockResolvedValue({ accountId, removed: true }),
    syncAccount: vi.fn().mockResolvedValue({
      account: account.account,
      counts: { inserted: 1, updated: 0, unchanged: 0 },
    }),
    updateAccountCredential: vi.fn().mockResolvedValue({
      account: account.account,
      counts: { inserted: 1, updated: 0, unchanged: 0 },
    }),
    connectGoogle: vi.fn().mockResolvedValue(account),
    reauthorizeGoogle: vi.fn().mockResolvedValue({
      account: account.account,
      counts: { inserted: 1, updated: 0, unchanged: 0 },
    }),
    getOutgoingSettings: vi.fn().mockResolvedValue(null),
    setOutgoingSettings: vi.fn().mockResolvedValue({
      host: "smtp.okamiops.com",
      port: 465,
      secure: true,
      fromAddresses: [],
      createdAt: now,
      updatedAt: now,
    }),
    listThreads: vi
      .fn()
      .mockResolvedValue({ threads: [thread], nextCursor: null }),
    getThread: vi.fn().mockResolvedValue({
      thread,
      messages: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          accountId,
          threadId,
          externalMessageId: "mail-1",
          direction: "incoming",
          sender: "Ana Silva <ana@cliente.com>",
          recipients: ["contato@okamiops.com"],
          body: '<section><h1 style="color:#f97316">Conteúdo externo</h1><img src="https://tracker.example/pixel.gif"><script>alert(1)</script></section>',
          bodyFormat: "html",
          sentAt: null,
          receivedAt: now,
          attachments: [{ filename: "brief.pdf", size: 2048 }],
          untrustedContent: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
    markThreadRead: vi.fn().mockResolvedValue({ ...thread, unreadCount: 0 }),
    markThreadUnread: vi.fn().mockResolvedValue({ ...thread, unreadCount: 1 }),
    moveThreadToSpam: vi.fn().mockResolvedValue({
      threadId,
      destination: "spam",
      moved: true,
    }),
    moveThreadToTrash: vi.fn().mockResolvedValue({
      threadId,
      destination: "trash",
      moved: true,
    }),
    listLanes: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockResolvedValue(taskResult),
    createReplyDraft: vi.fn().mockResolvedValue(replyDraftResult),
    createForwardDraft: vi.fn().mockResolvedValue(forwardDraftResult),
    listModels: vi.fn().mockResolvedValue(replyModels),
    generateReplyDraft: vi.fn().mockResolvedValue(replyDraftResult),
    analyzeThread: vi.fn().mockResolvedValue({
      threadId,
      action: "summary",
      content: "Resumo claro da conversa.",
      generatedAt: now,
    }),
    listReplyActions: vi.fn().mockResolvedValue([]),
    discardReply: vi.fn().mockResolvedValue({
      outboxId: replyAction.id,
      sourceThreadId: threadId,
      discarded: true,
    }),
    approveReply: vi.fn().mockResolvedValue({
      id: replyAction.id,
      status: "confirmed",
      attempts: 1,
      approvedAt: now,
      lastError: null,
    }),
    ...overrides,
  };
}

function renderInbox(api = makeApi()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    api,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <InboxPage api={api} />
      </QueryClientProvider>,
    ),
  };
}

const draftInstructions = "Agradeça o contato e confirme o prazo.";

async function configureAgentDraft(dialog: HTMLElement, model = "gpt-5.6") {
  await userEvent.type(
    within(dialog).getByLabelText("O que você quer responder?"),
    draftInstructions,
  );
  await userEvent.selectOptions(
    within(dialog).getByLabelText("Agente"),
    "codex:ChatGPT Plus",
  );
  await userEvent.selectOptions(within(dialog).getByLabelText("Modelo"), model);
}

describe("InboxPage", () => {
  it("does not resurrect unread badges from a stale remote refresh", () => {
    const stalePage = { threads: [thread, secondThread], nextCursor: null };

    expect(
      projectLocallyReadThreads(stalePage, new Set([threadId]), false).threads,
    ).toEqual([{ ...thread, unreadCount: 0 }, secondThread]);
  });

  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("opens a useful context menu from a thread row", async () => {
    renderInbox();
    const row = await screen.findByRole("button", {
      name: /Proposta para landing page/,
    });

    fireEvent.contextMenu(row, { clientX: 240, clientY: 180 });

    const menu = await screen.findByRole("menu", {
      name: "Ações para Proposta para landing page",
    });
    expect(
      within(menu).getByRole("menuitem", { name: "Abrir conversa" }),
    ).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: "Selecionar conversa" }),
    ).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: "Marcar como lida" }),
    ).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: "Mover para spam" }),
    ).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: "Mover para lixeira" }),
    ).toBeVisible();
  });

  it("selects multiple conversations and moves them with one confirmation", async () => {
    const api = makeApi({
      listThreads: vi.fn().mockResolvedValue({
        threads: [thread, secondThread],
        nextCursor: null,
      }),
    });
    renderInbox(api);
    await screen.findByText("2 conversas");

    await userEvent.click(
      screen.getByRole("button", { name: "Selecionar conversas" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: "Selecionar Proposta para landing page",
      }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Selecionar Revisão do contrato" }),
    );
    expect(screen.getByText("2 selecionadas")).toBeVisible();
    const bulkToolbar = screen.getByRole("toolbar", { name: "Ações em lote" });
    expect(
      within(bulkToolbar).getByRole("button", {
        name: "Marcar selecionadas como lidas",
      }),
    ).toHaveTextContent("Lidas");
    expect(
      within(bulkToolbar).getByRole("button", {
        name: "Marcar selecionadas como não lidas",
      }),
    ).toHaveTextContent("Não lidas");
    expect(
      within(bulkToolbar).getByRole("button", {
        name: "Mover selecionadas para spam",
      }),
    ).toHaveTextContent("Spam");
    expect(
      within(bulkToolbar).getByRole("button", { name: "Excluir selecionadas" }),
    ).toHaveTextContent("Lixeira");

    await userEvent.click(
      screen.getByRole("button", { name: "Excluir selecionadas" }),
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Confirmar exclusão de 2 conversas",
      }),
    );

    await vi.waitFor(() =>
      expect(api.moveThreadToTrash).toHaveBeenCalledTimes(2),
    );
    expect(
      screen.queryByText("Proposta para landing page"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Revisão do contrato")).not.toBeInTheDocument();
  });

  it("removes a deleted conversation optimistically while IMAP finishes", async () => {
    let finishMove:
      ((value: IpcResponse<"inbox:thread:moveToTrash">) => void) | undefined;
    const api = makeApi({
      moveThreadToTrash: vi.fn(
        () =>
          new Promise<IpcResponse<"inbox:thread:moveToTrash">>((resolve) => {
            finishMove = resolve;
          }),
      ),
    });
    renderInbox(api);
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Excluir conversa" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar exclusão" }),
    );

    expect(
      screen.queryByText("Proposta para landing page"),
    ).not.toBeInTheDocument();
    finishMove?.({ threadId, destination: "trash", moved: true });
  });

  it("moves the selected conversation to spam after explicit confirmation", async () => {
    const moveThreadToSpam = vi.fn().mockResolvedValue({
      threadId,
      destination: "spam",
      moved: true,
    });
    const api = Object.assign(makeApi(), { moveThreadToSpam });
    renderInbox(api);

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Mover conversa para spam" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar spam" }),
    );

    await vi.waitFor(() => expect(moveThreadToSpam).toHaveBeenCalledOnce());
    expect(moveThreadToSpam.mock.calls[0]?.[0]).toEqual({
      threadId,
      confirmation: "move_to_spam",
    });
    expect(
      await screen.findByRole("heading", { name: "Selecione uma conversa" }),
    ).toBeVisible();
  });

  it("moves the selected conversation to trash after explicit confirmation", async () => {
    const moveThreadToTrash = vi.fn().mockResolvedValue({
      threadId,
      destination: "trash",
      moved: true,
    });
    const api = Object.assign(makeApi(), { moveThreadToTrash });
    renderInbox(api);

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Excluir conversa" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar exclusão" }),
    );

    await vi.waitFor(() => expect(moveThreadToTrash).toHaveBeenCalledOnce());
    expect(moveThreadToTrash.mock.calls[0]?.[0]).toEqual({
      threadId,
      confirmation: "move_to_trash",
    });
    expect(
      await screen.findByRole("heading", { name: "Selecione uma conversa" }),
    ).toBeVisible();
  });

  it("renders the focused inbox, selects a thread and marks it read only once", async () => {
    const { api } = renderInbox();
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeVisible();
    const item = await screen.findByRole("button", {
      name: /Proposta para landing page/,
    });
    await userEvent.click(item);

    const emailDocument = await screen.findByTitle("Conteúdo HTML do email");
    expect(emailDocument).toHaveAttribute(
      "sandbox",
      "allow-same-origin allow-popups",
    );
    expect(emailDocument.getAttribute("srcdoc")).toContain("Conteúdo externo");
    expect(emailDocument.getAttribute("srcdoc")).not.toContain("<script");
    expect(emailDocument.getAttribute("srcdoc")).not.toContain(
      "https://tracker.example/pixel.gif",
    );
    expect(
      screen.getByText(
        "Imagens externas bloqueadas para proteger sua privacidade.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Sempre permitir imagens de ana@cliente.com",
      }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Carregar imagens agora" }),
    );
    expect(emailDocument.getAttribute("srcdoc")).toContain(
      "https://tracker.example/pixel.gif",
    );
    expect(localStorage.getItem(remoteImageTrustKey)).toBeNull();
    expect(screen.getByText("Próximo passo")).toBeVisible();
    expect(screen.getByText(/Nada é enviado sem sua aprovação/i)).toBeVisible();
    expect(api.markThreadRead).toHaveBeenCalledTimes(1);

    await userEvent.click(item);
    expect(api.markThreadRead).toHaveBeenCalledTimes(1);
  });

  it("remembers a trusted image sender locally and loads future messages", async () => {
    const first = renderInbox();
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    const firstFrame = await screen.findByTitle("Conteúdo HTML do email");

    await userEvent.click(
      screen.getByRole("button", {
        name: "Sempre permitir imagens de ana@cliente.com",
      }),
    );
    expect(firstFrame.getAttribute("srcdoc")).toContain(
      "https://tracker.example/pixel.gif",
    );
    expect(
      JSON.parse(localStorage.getItem(remoteImageTrustKey) ?? "[]"),
    ).toEqual(["ana@cliente.com"]);

    first.unmount();
    renderInbox();
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    const trustedFrame = await screen.findByTitle("Conteúdo HTML do email");
    expect(trustedFrame.getAttribute("srcdoc")).toContain(
      "https://tracker.example/pixel.gif",
    );
    expect(
      screen.queryByText(
        "Imagens externas bloqueadas para proteger sua privacidade.",
      ),
    ).toBeNull();
  });

  it("marks the selected conversation as unread without reopening it", async () => {
    const { api } = renderInbox();
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await screen.findByRole("button", {
      name: "Marcar conversa como não lida",
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Marcar conversa como não lida" }),
    );

    await vi.waitFor(() =>
      expect(api.markThreadUnread).toHaveBeenCalledWith(
        { threadId },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("Selecione uma conversa")).toBeVisible();
  });

  it("marks a conversation read immediately while the remote update is pending", async () => {
    const pendingMarkRead = new Promise<IpcResponse<"inbox:thread:markRead">>(
      () => undefined,
    );
    const markThreadRead = vi.fn().mockReturnValue(pendingMarkRead);
    const api = makeApi({
      listThreads: vi.fn().mockResolvedValue({
        threads: [thread, secondThread],
        nextCursor: null,
      }),
      getThread: vi.fn().mockImplementation(({ threadId: requestedId }) =>
        Promise.resolve({
          thread: requestedId === threadId ? thread : secondThread,
          messages: [],
        }),
      ),
      markThreadRead,
    });
    const rendered = renderInbox(api);

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await vi.waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(1));
    await userEvent.click(
      screen.getByRole("button", { name: /Revisão do contrato/ }),
    );

    expect(
      screen.getByRole("button", { name: /Proposta para landing page/ }),
    ).not.toHaveAttribute("data-unread");

    const [[activeThreadKey]] = rendered.queryClient.getQueriesData({
      queryKey: ["inbox", "threads"],
    });
    act(() => {
      rendered.queryClient.setQueryData(activeThreadKey, {
        threads: [thread, secondThread],
        nextCursor: null,
      });
    });

    expect(
      rendered.queryClient.getQueryData<IpcResponse<"inbox:threads:list">>(
        activeThreadKey,
      )?.threads[0]?.unreadCount,
    ).toBe(1);

    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Proposta para landing page/ }),
      ).not.toHaveAttribute("data-unread"),
    );
  });

  it("restores persisted column widths and keeps the contextual panel closed by default", async () => {
    localStorage.setItem("okami.inbox.sidebarWidth", "280");
    localStorage.setItem("okami.inbox.threadListWidth", "360");
    localStorage.setItem("okami.inbox.detailsWidth", "320");
    renderInbox();

    const page = screen.getByRole("region", { name: "Inbox" });
    expect(page).toHaveStyle({
      "--inbox-sidebar-width": "280px",
      "--inbox-thread-list-width": "360px",
      "--inbox-details-width": "320px",
    });
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(
      screen.queryByRole("complementary", { name: "Detalhes da conversa" }),
    ).toBeNull();

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Abrir detalhes" }),
    );

    expect(
      screen.getByRole("complementary", { name: "Detalhes da conversa" }),
    ).toBeVisible();
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });

  it("synchronizes connected accounts on entry and still allows a manual refresh", async () => {
    const { api } = renderInbox(
      makeApi({ listReplyActions: vi.fn().mockResolvedValue([replyAction]) }),
    );
    expect(await screen.findByText("Projetos")).toBeVisible();
    await vi.waitFor(() => expect(api.syncAccount).toHaveBeenCalledOnce());
    expect(vi.mocked(api.syncAccount).mock.calls[0]?.[0]).toEqual({
      accountId,
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Sincronizar Projetos" }),
    );
    await vi.waitFor(() => expect(api.syncAccount).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.syncAccount).mock.calls[1]?.[0]).toEqual({
      accountId,
    });
  });

  it("does not wake a paused account automatically", async () => {
    const paused = {
      ...account,
      account: { ...account.account, status: "paused" as const },
    };
    const api = makeApi({
      listAccounts: vi.fn().mockResolvedValue([paused]),
    });
    renderInbox(api);

    expect(await screen.findByText("Projetos")).toBeVisible();
    await Promise.resolve();
    expect(api.syncAccount).not.toHaveBeenCalled();
  });

  it("reconnects an existing Gmail account through Google OAuth without asking for a password", async () => {
    const gmail = {
      ...account,
      account: {
        ...account.account,
        provider: "gmail" as const,
        displayName: "Pessoal",
        address: "msant262@gmail.com",
        status: "auth_required" as const,
        lastError: "A autorização do Google expirou. Reconecte a conta.",
      },
      configuration: {
        ...account.configuration,
        host: "imap.gmail.com",
      },
    };
    const api = makeApi({
      listAccounts: vi.fn().mockResolvedValue([gmail]),
    });
    renderInbox(api);

    expect(
      await screen.findByText(/A autorização do Google expirou/),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Atualizar acesso de Pessoal" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText(/senha/i)).toBeNull();
    expect(
      within(dialog).getByText(/confirme o acesso no navegador/i),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Entrar com Google",
      }),
    );

    expect(vi.mocked(api.reauthorizeGoogle).mock.calls[0]?.[0]).toEqual({
      accountId,
    });
  });

  it("clears the password when the add-account modal closes or succeeds", async () => {
    const { api } = renderInbox();
    await screen.findByText("Projetos");
    await userEvent.click(
      screen.getByRole("button", { name: "Adicionar conta" }),
    );
    const password = screen.getByLabelText("Senha da conta");
    await userEvent.type(password, "segredo-local");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      screen.getByRole("button", { name: "Adicionar conta" }),
    );
    expect(screen.getByLabelText("Senha da conta")).toHaveValue("");

    const dialog = screen.getByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Nome da conta"),
      "Zoho",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Email da conta"),
      "marcos@zoho.com",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Servidor IMAP"),
      "imap.zoho.com",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Usuário IMAP"),
      "marcos@zoho.com",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Senha da conta"),
      "outra-senha",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Conectar conta" }),
    );
    expect(vi.mocked(api.addAccount).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        credential: expect.objectContaining({ password: "outra-senha" }),
      }),
    );
  });

  it("presents account connection as a grouped local-credential form", async () => {
    renderInbox();
    await screen.findByText("Projetos");
    await userEvent.click(
      screen.getByRole("button", { name: "Adicionar conta" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("group", { name: "Provedor da caixa" }),
    ).toBeVisible();
    expect(within(dialog).getByRole("radio", { name: /IMAP/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Zoho/ }));
    expect(within(dialog).getByRole("radio", { name: /Zoho/ })).toBeChecked();
    expect(
      within(dialog).getByRole("heading", { name: "Identificação da caixa" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("heading", { name: "Servidor de entrada" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("heading", { name: "Credenciais" }),
    ).toBeVisible();
    expect(
      within(dialog).getByText("As credenciais ficam somente neste Mac."),
    ).toBeVisible();
  });

  it("connects Gmail through a Desktop OAuth JSON and never asks for the Google password", async () => {
    const { api } = renderInbox();
    await screen.findByText("Projetos");
    await userEvent.click(
      screen.getByRole("button", { name: "Adicionar conta" }),
    );
    const dialog = screen.getByRole("dialog");

    await userEvent.click(within(dialog).getByRole("radio", { name: /Gmail/ }));
    expect(within(dialog).queryByLabelText(/senha/i)).toBeNull();
    expect(within(dialog).queryByLabelText("Servidor IMAP")).toBeNull();
    expect(
      within(dialog).getByText(/sua senha nunca entra no Okami/i),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Escolher JSON e entrar com Google",
      }),
    );

    expect(api.connectGoogle).toHaveBeenCalledOnce();
    expect(api.addAccount).not.toHaveBeenCalled();
  });

  it("filters unread threads, confirms removal and hides actions without a conversation", async () => {
    const { api } = renderInbox();
    await screen.findByText("Projetos");
    await userEvent.click(screen.getByRole("button", { name: "Não lidos" }));
    expect(api.listThreads).toHaveBeenLastCalledWith({
      flow: "inbox",
      unreadOnly: true,
      limit: 100,
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Remover Projetos" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remover conta" }),
    );
    expect(vi.mocked(api.removeAccount).mock.calls[0]?.[0]).toEqual({
      accountId,
    });

    expect(screen.queryByRole("button", { name: "Pedir rascunho" })).toBeNull();
  });

  it("opens mentions, delegated, spam and trash as real inbox flows", async () => {
    const { api } = renderInbox();
    await screen.findByText("Projetos");

    for (const [label, flow] of [
      ["Menções e diretos", "mentions"],
      ["Delegados a agente", "delegated"],
      ["Spam", "spam"],
      ["Lixeira", "trash"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      expect(api.listThreads).toHaveBeenLastCalledWith({ flow, limit: 100 });
      expect(
        screen.getByText(label, { selector: ".inbox-eyebrow" }),
      ).toBeVisible();
    }
  });

  it("keeps the unread badge scoped to inbox while browsing spam", async () => {
    const spamThreads = [
      {
        ...thread,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        folder: "spam" as const,
      },
      {
        ...thread,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        folder: "spam" as const,
      },
    ];
    const listThreads = vi.fn(
      async (request: IpcRequest<"inbox:threads:list">) => ({
        threads: request.flow === "spam" ? spamThreads : [thread],
        nextCursor: null,
      }),
    );
    renderInbox(makeApi({ listThreads }));

    const unread = await screen.findByRole("button", { name: "Não lidos" });
    expect(await within(unread).findByText("1")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Spam" }));
    expect(
      await screen.findByText("Spam", { selector: ".inbox-eyebrow" }),
    ).toBeVisible();
    expect(within(unread).getByText("1")).toBeVisible();
    expect(listThreads).toHaveBeenCalledWith({
      flow: "inbox",
      unreadOnly: true,
      limit: 100,
    });
  });

  it("generates an approval-pending agent draft only after an explicit catalog choice", async () => {
    const { api } = renderInbox();
    expect(api.listModels).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    const draft = screen.getByRole("button", { name: "Pedir rascunho" });
    expect(draft).toBeEnabled();
    expect(api.listModels).not.toHaveBeenCalled();

    await userEvent.click(draft);
    const dialog = await screen.findByRole("dialog");
    expect(api.listModels).toHaveBeenCalledOnce();
    expect(within(dialog).queryByText("Não deve aparecer")).toBeNull();
    expect(
      within(dialog).getByText(/Usa uma turn da assinatura escolhida/i),
    ).toBeVisible();

    await configureAgentDraft(dialog);
    expect(within(dialog).getByLabelText("Effort")).toHaveValue("medium");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Gerar rascunho" }),
    );

    await vi.waitFor(() =>
      expect(api.generateReplyDraft).toHaveBeenCalledOnce(),
    );
    expect(vi.mocked(api.generateReplyDraft).mock.calls[0]?.[0]).toEqual({
      threadId,
      runtimeKind: "codex",
      model: "gpt-5.6",
      effort: "medium",
      fromAddress: "contato@okamiops.com",
      instructions: draftInstructions,
    });
    expect(api.approveReply).not.toHaveBeenCalled();
    expect(await screen.findByText("Aguardando sua aprovação")).toBeVisible();
  });

  it("opens a roomy email assistant, exposes every runnable provider, and analyzes beside the message", async () => {
    const { api } = renderInbox();
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Ações com IA" }));
    const assistant = await screen.findByRole("complementary", {
      name: "Assistente do e-mail",
    });
    expect(
      screen.queryByRole("complementary", { name: "Detalhes da conversa" }),
    ).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const inboxPage = assistant.closest(".inbox-page");
    expect(inboxPage).toHaveAttribute("data-context-panel", "assistant");
    await userEvent.click(
      within(assistant).getByRole("button", { name: "Expandir assistente" }),
    );
    expect(inboxPage).toHaveAttribute("data-assistant-expanded", "true");
    expect(
      within(assistant).getByRole("button", { name: "Reduzir assistente" }),
    ).toBeVisible();
    await vi.waitFor(() => expect(api.listModels).toHaveBeenCalled());
    const prompt = within(assistant).getByLabelText("O que você quer saber?");
    expect(prompt).toHaveValue("");
    expect(within(assistant).getByLabelText("Provider")).toHaveValue("codex");
    expect(within(assistant).getByLabelText("Modelo")).toHaveValue("gpt-5.6");
    expect(within(assistant).getByLabelText("Provider")).toHaveTextContent(
      "Grok",
    );
    expect(within(assistant).getByLabelText("Provider")).toHaveTextContent(
      "MiMo",
    );
    expect(within(assistant).getByLabelText("Provider")).toHaveTextContent(
      "MiniMax",
    );
    await userEvent.click(
      within(assistant).getByRole("button", { name: "Resumir" }),
    );
    expect(prompt).toHaveValue(
      "Resuma este email em português do Brasil, com objetividade.",
    );
    await userEvent.selectOptions(
      within(assistant).getByLabelText("Provider"),
      "agy",
    );
    await userEvent.selectOptions(
      within(assistant).getByLabelText("Modelo"),
      "gemini-3.5-flash",
    );
    await userEvent.click(
      within(assistant).getByRole("button", { name: "Enviar para análise" }),
    );

    await vi.waitFor(() => expect(api.analyzeThread).toHaveBeenCalledOnce());
    expect(vi.mocked(api.analyzeThread).mock.calls[0]?.[0]).toMatchObject({
      threadId,
      runtimeKind: "agy",
      model: "gemini-3.5-flash",
      effort: "high",
      action: "summary",
    });
    expect(
      await within(assistant).findByText("Resumo claro da conversa."),
    ).toBeVisible();
    expect(
      within(assistant).getByRole("button", { name: "Copiar resposta" }),
    ).toBeVisible();
    expect(within(assistant).getByText("Resposta gerada")).toBeVisible();
    expect(
      within(assistant).getByRole("article", { name: "Resposta da IA" }),
    ).toBeVisible();
    expect(within(assistant).getAllByText("Antigravity")).not.toHaveLength(0);
    expect(within(assistant).getAllByText("Gemini 3.5 Flash")).not.toHaveLength(
      0,
    );
    expect(api.createReplyDraft).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Abrir detalhes" }),
    );
    expect(
      await screen.findByRole("complementary", {
        name: "Detalhes da conversa",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("complementary", { name: "Assistente do e-mail" }),
    ).toBeNull();
  });

  it("identifies the selected provider and model when email analysis fails", async () => {
    const analyzeThread = vi
      .fn<InboxApi["analyzeThread"]>()
      .mockRejectedValue(new Error("runtime indisponível"));
    renderInbox(makeApi({ analyzeThread }));

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Ações com IA" }));
    const assistant = await screen.findByRole("complementary", {
      name: "Assistente do e-mail",
    });
    await vi.waitFor(() =>
      expect(within(assistant).getByLabelText("Provider")).toHaveValue("codex"),
    );

    await userEvent.type(
      within(assistant).getByLabelText("O que você quer saber?"),
      "Resuma os próximos passos.",
    );
    await userEvent.click(
      within(assistant).getByRole("button", { name: "Enviar para análise" }),
    );

    const error = await within(assistant).findByRole("alert");
    expect(error).toHaveTextContent(/ChatGPT Plus.*GPT-5\.6/i);
    expect(error).toHaveTextContent(/este provider não respondeu/i);
    expect(error).toHaveTextContent(/tente novamente.*outro provider/i);
  });

  it("requires drafting instructions and sends them with compact agent and model choices", async () => {
    const { api } = renderInbox();
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pedir rascunho" }),
    );

    const dialog = await screen.findByRole("dialog");
    const instructions = within(dialog).getByLabelText(
      "O que você quer responder?",
    );
    const agent = within(dialog).getByLabelText("Agente");
    const model = within(dialog).getByLabelText("Modelo");
    const submit = within(dialog).getByRole("button", {
      name: "Gerar rascunho",
    });

    expect(instructions).toHaveAttribute(
      "placeholder",
      expect.stringMatching(/agradeça/i),
    );
    expect(agent).toHaveRole("combobox");
    expect(model).toHaveRole("combobox");
    expect(submit).toBeDisabled();

    await userEvent.type(
      instructions,
      "Agradeça o contato, confirme o prazo de cinco dias e peça o briefing.",
    );
    await userEvent.selectOptions(agent, "codex:ChatGPT Plus");
    await userEvent.selectOptions(model, "gpt-5.6");
    await userEvent.click(submit);

    await vi.waitFor(() =>
      expect(api.generateReplyDraft).toHaveBeenCalledOnce(),
    );
    expect(vi.mocked(api.generateReplyDraft).mock.calls[0]?.[0]).toEqual({
      threadId,
      runtimeKind: "codex",
      model: "gpt-5.6",
      effort: "medium",
      fromAddress: "contato@okamiops.com",
      instructions:
        "Agradeça o contato, confirme o prazo de cinco dias e peça o briefing.",
    });
  });

  it("omits effort for models that do not declare it and blocks duplicate generation", async () => {
    let resolveDraft: (() => void) | undefined;
    const generateReplyDraft = vi.fn<InboxApi["generateReplyDraft"]>(
      () =>
        new Promise<IpcResponse<"inbox:thread:generateReplyDraft">>(
          (resolve) => {
            resolveDraft = () => resolve(replyDraftResult);
          },
        ),
    );
    renderInbox(makeApi({ generateReplyDraft }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pedir rascunho" }),
    );
    const dialog = await screen.findByRole("dialog");
    await configureAgentDraft(dialog, "gpt-5.6-mini");
    expect(within(dialog).queryByLabelText("Effort")).toBeNull();

    const submit = within(dialog).getByRole("button", {
      name: "Gerar rascunho",
    });
    await userEvent.click(submit);
    await userEvent.click(submit);
    expect(
      within(dialog).getByRole("button", { name: "Gerando…" }),
    ).toBeDisabled();
    expect(generateReplyDraft).toHaveBeenCalledOnce();
    expect(generateReplyDraft.mock.calls[0]?.[0]).toEqual({
      threadId,
      runtimeKind: "codex",
      model: "gpt-5.6-mini",
      fromAddress: "contato@okamiops.com",
      instructions: draftInstructions,
    });
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.click(document.querySelector('[data-slot="modal-backdrop"]')!);
    expect(screen.getByRole("dialog")).toBeVisible();
    resolveDraft?.();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps a generated approval card when an older reply-actions query resolves late", async () => {
    let resolveReplyActions:
      | ((value: IpcResponse<"inbox:thread:replyActions:list">) => void)
      | undefined;
    const listReplyActions = vi.fn<InboxApi["listReplyActions"]>(
      () =>
        new Promise<IpcResponse<"inbox:thread:replyActions:list">>(
          (resolve) => {
            resolveReplyActions = resolve;
          },
        ),
    );
    const { queryClient } = renderInbox(makeApi({ listReplyActions }));
    const cancelQueries = vi.spyOn(queryClient, "cancelQueries");
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await vi.waitFor(() => expect(listReplyActions).toHaveBeenCalledOnce());
    await userEvent.click(
      screen.getByRole("button", { name: "Pedir rascunho" }),
    );
    const dialog = await screen.findByRole("dialog");
    await configureAgentDraft(dialog);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Gerar rascunho" }),
    );
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(cancelQueries).toHaveBeenCalledWith({
      queryKey: ["inbox", "reply-actions", threadId],
    });

    resolveReplyActions?.([]);
    expect(await screen.findByText("Aguardando sua aprovação")).toBeVisible();
  });

  it("keeps choices open and exposes a Portuguese alert when draft generation fails", async () => {
    const generateReplyDraft = vi
      .fn()
      .mockRejectedValue(new Error("Serviço indisponível"));
    renderInbox(makeApi({ generateReplyDraft }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pedir rascunho" }),
    );
    const dialog = await screen.findByRole("dialog");
    await configureAgentDraft(dialog);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Gerar rascunho" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Serviço indisponível",
    );
    expect(within(dialog).getByLabelText("Modelo")).toHaveValue("gpt-5.6");
  });

  it("maps backend errors to Portuguese without leaking unknown English text", async () => {
    const generateReplyDraft = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Selected reply-generation runtime is unavailable"),
      )
      .mockRejectedValueOnce(new Error("Internal provider error 5xx"));
    renderInbox(makeApi({ generateReplyDraft }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pedir rascunho" }),
    );
    const dialog = await screen.findByRole("dialog");
    await configureAgentDraft(dialog);
    const submit = within(dialog).getByRole("button", {
      name: "Gerar rascunho",
    });
    await userEvent.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "O runtime selecionado não está disponível. Escolha outra opção.",
    );
    expect(
      within(dialog).queryByText(
        "Selected reply-generation runtime is unavailable",
      ),
    ).toBeNull();

    await userEvent.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Não foi possível gerar o rascunho. Tente novamente.",
    );
    expect(
      within(dialog).queryByText("Internal provider error 5xx"),
    ).toBeNull();
    expect(within(dialog).getByLabelText("Modelo")).toHaveValue("gpt-5.6");
  });

  it("saves a trimmed reply as approval pending without sending an email", async () => {
    const { api } = renderInbox(
      makeApi({
        getOutgoingSettings: vi.fn().mockResolvedValue({
          host: "smtp.okamiops.com",
          port: 465,
          secure: true,
          fromAddresses: ["propostas@okamiops.com"],
          createdAt: now,
          updatedAt: now,
        }),
        listReplyActions: vi.fn().mockResolvedValue([replyAction]),
      }),
    );
    expect(screen.queryByRole("button", { name: "Responder" })).toBeNull();

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Responder" }));

    const dialog = screen.getByRole("dialog");
    await vi.waitFor(() =>
      expect(within(dialog).getByLabelText("Enviar como")).toHaveValue(
        "contato@okamiops.com",
      ),
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Enviar como"),
      "propostas@okamiops.com",
    );
    expect(within(dialog).getByLabelText("Destinatário")).toHaveValue(
      "Ana Silva <ana@cliente.com>",
    );
    expect(within(dialog).getByLabelText("Destinatário")).toHaveAttribute(
      "readonly",
    );
    expect(within(dialog).getByLabelText("Assunto")).toHaveValue(
      "Re: Proposta para landing page",
    );
    expect(within(dialog).getByLabelText("Assunto")).toHaveAttribute(
      "readonly",
    );
    expect(within(dialog).getByText("0 / 20.000")).toBeVisible();
    expect(
      within(dialog).getByText(/Salvar não envia nenhum email/i),
    ).toBeVisible();

    await userEvent.type(
      within(dialog).getByLabelText("Resposta"),
      "  Obrigado pela mensagem.  ",
    );
    expect(within(dialog).getByText("27 / 20.000")).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar para aprovação" }),
    );

    await vi.waitFor(() => expect(api.createReplyDraft).toHaveBeenCalledOnce());
    expect(vi.mocked(api.createReplyDraft).mock.calls[0]?.[0]).toEqual({
      threadId,
      body: "Obrigado pela mensagem.",
      fromAddress: "propostas@okamiops.com",
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
    expect(await screen.findByText("Aguardando sua aprovação")).toBeVisible();
    expect(api).not.toHaveProperty("laneSendTurn");
  });

  it("sends a human-authored forward directly with sender, recipients and an optional note", async () => {
    const { api } = renderInbox(
      makeApi({
        getOutgoingSettings: vi.fn().mockResolvedValue({
          host: "smtp.okamiops.com",
          port: 465,
          secure: true,
          fromAddresses: ["propostas@okamiops.com"],
          createdAt: now,
          updatedAt: now,
        }),
        approveReply: vi.fn().mockResolvedValue({
          id: forwardDraftResult.id,
          status: "confirmed",
          attempts: 1,
          approvedAt: now,
          lastError: null,
        }),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Encaminhar" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Encaminhar email" }),
    ).toBeVisible();
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Enviar como"),
      "propostas@okamiops.com",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Destinatários"),
      "propostas@cliente.com, financeiro@cliente.com",
    );
    await userEvent.type(
      within(dialog).getByLabelText("Nota antes da mensagem"),
      "  Segue para análise.  ",
    );
    expect(
      within(dialog).getByText(/Anexos do email original não serão incluídos/i),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Encaminhar agora" }),
    );

    await vi.waitFor(() =>
      expect(api.createForwardDraft).toHaveBeenCalledOnce(),
    );
    expect(vi.mocked(api.createForwardDraft).mock.calls[0]?.[0]).toEqual({
      threadId,
      fromAddress: "propostas@okamiops.com",
      to: ["propostas@cliente.com", "financeiro@cliente.com"],
      note: "Segue para análise.",
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
    await vi.waitFor(() => expect(api.approveReply).toHaveBeenCalledOnce());
    expect(api.approveReply).toHaveBeenCalledWith({
      outboxId: forwardDraftResult.id,
      confirmation: "approve_and_send",
    });
    expect(await screen.findByText("Email enviado")).toBeVisible();
  });

  it("keeps the forward open with a useful error when SMTP is not configured", async () => {
    const { api } = renderInbox(
      makeApi({
        approveReply: vi
          .fn()
          .mockRejectedValue(new Error("Outgoing email is not configured")),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Destinatários"),
      "destino@cliente.com",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Encaminhar agora" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Configure o envio SMTP desta caixa antes de encaminhar. O rascunho foi preservado.",
    );
    expect(api.createForwardDraft).toHaveBeenCalledOnce();
    expect(api.approveReply).toHaveBeenCalledOnce();
  });

  it("validates reply body and preserves it with one key across a failed retry", async () => {
    let resolveCreation: (() => void) | undefined;
    const createReplyDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error("Outbox indisponível"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCreation = () => resolve(replyDraftResult);
          }),
      );
    const { api } = renderInbox(
      makeApi({
        createReplyDraft,
        listReplyActions: vi.fn().mockResolvedValue([replyAction]),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Responder" }));
    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByLabelText("Resposta");
    const submit = within(dialog).getByRole("button", {
      name: "Salvar para aprovação",
    });

    await userEvent.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Escreva uma resposta antes de salvar.",
    );
    expect(createReplyDraft).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "x".repeat(20_001) } });
    await userEvent.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A resposta pode ter no máximo 20.000 caracteres.",
    );
    expect(createReplyDraft).not.toHaveBeenCalled();

    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Resposta revisada");
    await userEvent.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Outbox indisponível",
    );
    await userEvent.click(submit);
    expect(
      within(dialog).getByRole("button", { name: "Salvando…" }),
    ).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvando…" }),
    );
    expect(createReplyDraft).toHaveBeenCalledTimes(2);
    expect(createReplyDraft.mock.calls[1]?.[0].idempotencyKey).toBe(
      createReplyDraft.mock.calls[0]?.[0].idempotencyKey,
    );
    expect(textarea).toHaveValue("Resposta revisada");
    resolveCreation?.();
    expect(await screen.findByText("Aguardando sua aprovação")).toBeVisible();
    expect(api.createReplyDraft).toHaveBeenCalledTimes(2);
  });

  it("creates a manual Kanban task from the selected email without starting a lane", async () => {
    const { api } = renderInbox();
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await screen.findByTitle("Conteúdo HTML do email");

    await userEvent.click(screen.getByRole("button", { name: "Virar tarefa" }));
    expect(
      screen.getByRole("heading", { name: "Transformar em tarefa" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Título da tarefa")).toHaveValue(
      "Proposta para landing page",
    );
    expect(screen.getByText(/nenhum agente será iniciado/i)).toBeVisible();

    await userEvent.type(
      screen.getByLabelText("Instrução da tarefa"),
      "Preparar a proposta e validar escopo e prazo.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    await vi.waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createTask).mock.calls[0]?.[0]).toEqual({
      threadId,
      mode: "manual",
      laneId: null,
      title: "Proposta para landing page",
      instruction: "Preparar a proposta e validar escopo e prazo.",
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
    expect(api.listLanes).not.toHaveBeenCalled();
    expect(api).not.toHaveProperty("laneSendTurn");
    expect(
      await screen.findByText(
        "Tarefa criada no Kanban. Nenhum agente foi iniciado.",
      ),
    ).toBeVisible();
  });

  it("only offers workspace lanes when preparing an email task for an agent", async () => {
    const noWorkspaceLane = { ...workspaceLane, workspacePath: null };
    const { api } = renderInbox(
      makeApi({
        listLanes: vi.fn().mockResolvedValue([noWorkspaceLane, workspaceLane]),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Virar tarefa" }));
    await userEvent.click(
      screen.getByRole("radio", { name: /Delegar acompanhamento/ }),
    );

    const providerSelect = await screen.findByRole("combobox", {
      name: "Provider da tarefa",
    });
    expect(providerSelect).toHaveTextContent("Anthropic Max");
    await userEvent.selectOptions(
      providerSelect,
      `${workspaceLane.runtimeKind}:${workspaceLane.providerAccountLabel}`,
    );
    const modelSelect = screen.getByRole("combobox", {
      name: "Modelo da tarefa",
    });
    expect(modelSelect).toHaveTextContent("Claude Sonnet 4.5");
    await userEvent.selectOptions(modelSelect, workspaceLane.model);
    const workspaceSelect = screen.getByRole("combobox", {
      name: "Projeto da tarefa",
    });
    expect(workspaceSelect).toHaveTextContent("Projetos/landing");
    await userEvent.selectOptions(
      workspaceSelect,
      workspaceLane.workspacePath ?? "",
    );
    await userEvent.type(
      screen.getByLabelText("Instrução da tarefa"),
      "Revisar o pedido e preparar uma resposta para aprovação.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));

    await vi.waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createTask).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        threadId,
        mode: "delegate",
        laneId: workspaceLane.laneId,
      }),
    );
  });

  it("keeps task choices on failure, blocks double submit and reuses the idempotency key", async () => {
    let resolveCreation: (() => void) | undefined;
    const createTask = vi
      .fn()
      .mockRejectedValueOnce(new Error("Kanban indisponível"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCreation = () => resolve(taskResult);
          }),
      );
    const { api } = renderInbox(makeApi({ createTask }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Virar tarefa" }));
    await userEvent.clear(screen.getByLabelText("Título da tarefa"));
    await userEvent.type(
      screen.getByLabelText("Título da tarefa"),
      "Proposta revisada",
    );
    await userEvent.type(
      screen.getByLabelText("Instrução da tarefa"),
      "Revisar a proposta e listar os próximos passos.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kanban indisponível",
    );

    await userEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    expect(screen.getByRole("button", { name: "Criando…" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Criando…" }));
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls[1]?.[0].idempotencyKey).toBe(
      createTask.mock.calls[0]?.[0].idempotencyKey,
    );
    resolveCreation?.();
    expect(
      await screen.findByText(
        "Tarefa criada no Kanban. Nenhum agente foi iniciado.",
      ),
    ).toBeVisible();
    expect(api.createTask).toHaveBeenCalledTimes(2);
  });

  it("removes a read thread from the unread cache", async () => {
    const { api } = renderInbox();
    await screen.findByText("Projetos");
    await userEvent.click(screen.getByRole("button", { name: "Não lidos" }));
    const item = await screen.findByRole("button", {
      name: /Proposta para landing page/,
    });
    await userEvent.click(item);

    await vi.waitFor(() => expect(api.markThreadRead).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Nenhuma conversa nesta fila."),
    ).toBeVisible();
  });

  it("clears the selected conversation when its account is removed", async () => {
    const { api } = renderInbox();
    const item = await screen.findByRole("button", {
      name: /Proposta para landing page/,
    });
    await userEvent.click(item);
    await screen.findByTitle("Conteúdo HTML do email");

    await userEvent.click(
      screen.getByRole("button", { name: "Remover Projetos" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remover conta" }),
    );

    expect(api.removeAccount).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Selecione uma conversa")).toBeVisible();
  });

  it("allows mark-read to be retried after an error without looping", async () => {
    const secondThread = {
      ...thread,
      id: "44444444-4444-4444-8444-444444444444",
      externalThreadId: "message-13",
      subject: "Segunda conversa",
      unreadCount: 0,
    };
    const markThreadRead = vi
      .fn()
      .mockRejectedValueOnce(new Error("Falha temporária"))
      .mockResolvedValue({ ...thread, unreadCount: 0 });
    const api = makeApi({
      listThreads: vi.fn().mockResolvedValue({
        threads: [thread, secondThread],
        nextCursor: null,
      }),
      getThread: vi.fn().mockImplementation(({ threadId: requestedId }) =>
        Promise.resolve({
          thread: requestedId === threadId ? thread : secondThread,
          messages: [],
        }),
      ),
      markThreadRead,
    });
    renderInbox(api);

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    expect(markThreadRead).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByRole("button", { name: /Segunda conversa/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Proposta para landing page/ }),
    );
    expect(markThreadRead).toHaveBeenCalledTimes(2);
  });

  it("loads outgoing settings only on open and starts an absent configuration safely", async () => {
    const getOutgoingSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("Configuração indisponível"))
      .mockResolvedValueOnce(null);
    const setOutgoingSettings = vi.fn();
    const api = Object.assign(makeApi(), {
      getOutgoingSettings,
      setOutgoingSettings,
    });
    renderInbox(api);

    await screen.findByText("Projetos");
    expect(getOutgoingSettings).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Configurar envio de Projetos" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(getOutgoingSettings).toHaveBeenCalledWith({ accountId });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Configuração indisponível",
    );
    expect(
      within(dialog).getByRole("button", { name: "Salvar configuração" }),
    ).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Tentar novamente" }),
    );
    await vi.waitFor(() =>
      expect(getOutgoingSettings).toHaveBeenCalledTimes(2),
    );
    expect(within(dialog).getByLabelText("Servidor SMTP")).toHaveValue("");
    expect(within(dialog).getByLabelText("Porta SMTP")).toHaveValue(465);
    expect(within(dialog).getByLabelText("Usar TLS direto")).toBeChecked();
    expect(
      within(dialog).getByText(
        "Configurar não envia email nem testa a conexão.",
      ),
    ).toBeVisible();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar configuração" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Informe o servidor SMTP.",
    );
    expect(setOutgoingSettings).not.toHaveBeenCalled();
  });

  it("preserves outgoing settings on failure, blocks double save and reloads when reopened", async () => {
    let resolveSave: (() => void) | undefined;
    const getOutgoingSettings = vi
      .fn()
      .mockResolvedValueOnce({
        host: "smtp.okamiops.com",
        port: 587,
        secure: false,
        fromAddresses: ["propostas@okamiops.com"],
        createdAt: now,
        updatedAt: now,
      })
      .mockResolvedValueOnce({
        host: "smtp.reloaded.example",
        port: 465,
        secure: true,
        fromAddresses: ["financeiro@okamiops.com"],
        createdAt: now,
        updatedAt: now,
      });
    const setOutgoingSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("SMTP indisponível"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = () => resolve(undefined);
          }),
      );
    const api = Object.assign(makeApi(), {
      getOutgoingSettings,
      setOutgoingSettings,
    });
    renderInbox(api);

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Configurar envio de Projetos",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    const host = within(dialog).getByLabelText("Servidor SMTP");
    const port = within(dialog).getByLabelText("Porta SMTP");
    expect(host).toHaveValue("smtp.okamiops.com");
    expect(port).toHaveValue(587);
    expect(within(dialog).getByLabelText("Usar TLS direto")).not.toBeChecked();

    await userEvent.clear(port);
    await userEvent.type(port, "70000");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar configuração" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Informe uma porta entre 1 e 65535.",
    );
    expect(setOutgoingSettings).not.toHaveBeenCalled();

    await userEvent.clear(port);
    await userEvent.type(port, "465");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar configuração" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "SMTP indisponível",
    );
    expect(host).toHaveValue("smtp.okamiops.com");
    expect(port).toHaveValue(465);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvar configuração" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Salvando…" }),
    ).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Salvando…" }),
    );
    expect(setOutgoingSettings).toHaveBeenCalledTimes(2);
    expect(setOutgoingSettings).toHaveBeenLastCalledWith({
      accountId,
      configuration: {
        host: "smtp.okamiops.com",
        port: 465,
        secure: false,
        fromAddresses: ["propostas@okamiops.com"],
      },
    });
    resolveSave?.();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(
      screen.getByRole("button", { name: "Configurar envio de Projetos" }),
    );
    const reopened = await screen.findByRole("dialog");
    expect(getOutgoingSettings).toHaveBeenCalledTimes(2);
    expect(within(reopened).getByLabelText("Servidor SMTP")).toHaveValue(
      "smtp.reloaded.example",
    );
  });

  it("approves the selected persistent reply once and renders the confirmed state", async () => {
    let persistedAction: IpcResponse<"inbox:thread:replyActions:list">[number] =
      replyAction;
    const listReplyActions = vi.fn(() => Promise.resolve([persistedAction]));
    const approveReply = vi.fn(async () => {
      persistedAction = {
        ...replyAction,
        status: "confirmed",
        attempts: 1,
        approvedAt: now,
      };
      return {
        id: replyAction.id,
        status: "confirmed" as const,
        attempts: 1,
        approvedAt: now,
        lastError: null,
      };
    });
    const { api } = renderInbox(makeApi({ listReplyActions, approveReply }));

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Aprovar e enviar" }),
    );

    await vi.waitFor(() => expect(approveReply).toHaveBeenCalledOnce());
    expect(approveReply).toHaveBeenCalledWith({
      outboxId: replyAction.id,
      confirmation: "approve_and_send",
    });
    expect(await screen.findByText("Email enviado")).toBeVisible();
    expect(api.listReplyActions).toHaveBeenCalledWith({ threadId });
  });

  it("discards an unsent reply draft and removes it from the conversation", async () => {
    const discardReply = vi.fn().mockResolvedValue({
      outboxId: replyAction.id,
      sourceThreadId: threadId,
      discarded: true as const,
    });
    renderInbox(
      makeApi({
        discardReply,
        listReplyActions: vi.fn().mockResolvedValue([replyAction]),
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Descartar rascunho" }),
    );

    await vi.waitFor(() => expect(discardReply).toHaveBeenCalledOnce());
    expect(discardReply).toHaveBeenCalledWith({
      outboxId: replyAction.id,
      threadId,
      confirmation: "discard_unsent_draft",
    });
    expect(screen.queryByText("Aguardando sua aprovação")).toBeNull();
  });

  it("prevents duplicate approval while dispatch is pending", async () => {
    let resolveApproval: (() => void) | undefined;
    const approveReply = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveApproval = () =>
              resolve({
                id: replyAction.id,
                status: "dispatching",
                attempts: 1,
                approvedAt: now,
                lastError: null,
              });
          }),
      )
      .mockRejectedValueOnce(new Error("Envio indisponível"));
    renderInbox(
      makeApi({
        approveReply,
        listReplyActions: vi.fn().mockResolvedValue([replyAction]),
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    const approve = await screen.findByRole("button", {
      name: "Aprovar e enviar",
    });
    await userEvent.click(approve);
    await userEvent.click(approve);
    expect(approveReply).toHaveBeenCalledOnce();
    resolveApproval?.();
    await vi.waitFor(() => expect(approveReply).toHaveBeenCalledOnce());
  });

  it("keeps a reply action visible with an accessible error when approval fails", async () => {
    const approveReply = vi
      .fn()
      .mockRejectedValue(new Error("Reply dispatch is unavailable"));
    renderInbox(
      makeApi({
        approveReply,
        listReplyActions: vi.fn().mockResolvedValue([replyAction]),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Aprovar e enviar" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "O envio não está disponível agora. O email continua aguardando aprovação.",
    );
    expect(screen.getByText("Aguardando sua aprovação")).toBeVisible();
  });

  it("renders an inert sending control for a persistent dispatching action", async () => {
    const approveReply = vi.fn();
    renderInbox(
      makeApi({
        approveReply,
        listReplyActions: vi.fn().mockResolvedValue([
          {
            ...replyAction,
            status: "dispatching",
            attempts: 1,
            approvedAt: now,
          },
        ]),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    const sending = await screen.findByRole("button", {
      name: "Aprovar e enviar",
    });
    expect(sending).toBeDisabled();
    expect(sending).toHaveTextContent("Enviando…");
    await userEvent.click(sending);
    expect(approveReply).not.toHaveBeenCalled();
  });

  it("shows uncertain replies without an approve or retry action", async () => {
    renderInbox(
      makeApi({
        listReplyActions: vi
          .fn()
          .mockResolvedValue([
            { ...replyAction, status: "uncertain", attempts: 1 },
          ]),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    expect(await screen.findByText("Resultado do envio incerto")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não envie novamente antes de confirmar o resultado com o provedor.",
    );
    expect(
      screen.queryByRole("button", { name: /Aprovar|Tentar novamente/i }),
    ).toBeNull();
  });

  it("never displays another thread's reply action after switching conversations", async () => {
    const otherThread = {
      ...thread,
      id: "88888888-8888-4888-8888-888888888888",
      externalThreadId: "message-13",
      subject: "Outra conversa",
      unreadCount: 0,
    };
    renderInbox(
      makeApi({
        listThreads: vi.fn().mockResolvedValue({
          threads: [thread, otherThread],
          nextCursor: null,
        }),
        getThread: vi
          .fn()
          .mockImplementation(({ threadId: requestedThreadId }) =>
            Promise.resolve({
              thread: requestedThreadId === threadId ? thread : otherThread,
              messages: [],
            }),
          ),
        listReplyActions: vi.fn().mockResolvedValue([replyAction]),
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /Proposta para landing page/ }),
    );
    expect(await screen.findByText("Aguardando sua aprovação")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: /Outra conversa/ }),
    );
    await screen.findByRole("heading", { name: "Outra conversa" });
    expect(screen.queryByText("Aguardando sua aprovação")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Aprovar e enviar" }),
    ).toBeNull();
  });

  it("states loading, empty and error without inventing inbox content", async () => {
    const loadingApi = makeApi({
      listAccounts: () => new Promise(() => undefined),
    });
    const { unmount } = renderInbox(loadingApi);
    expect(screen.getByText("Carregando contas…")).toBeVisible();
    unmount();

    renderInbox(
      makeApi({
        listAccounts: vi.fn().mockResolvedValue([]),
        listThreads: vi
          .fn()
          .mockResolvedValue({ threads: [], nextCursor: null }),
      }),
    );
    expect(await screen.findByText("Conecte a primeira caixa")).toBeVisible();

    cleanup();
    renderInbox(
      makeApi({
        listThreads: vi.fn().mockRejectedValue(new Error("Caixa indisponível")),
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Caixa indisponível",
    );
  });
});

void ({} as IpcRequest<"inbox:account:add">);
