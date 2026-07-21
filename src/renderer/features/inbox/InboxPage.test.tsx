import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { InboxPage, type InboxApi } from "./InboxPage";

const accountId = "11111111-1111-4111-8111-111111111111";
const threadId = "22222222-2222-4222-8222-222222222222";
const now = "2026-07-21T09:30:00.000Z";

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
  createdAt: now,
  updatedAt: now,
};

function makeApi(overrides: Partial<InboxApi> = {}): InboxApi {
  return {
    listAccounts: vi.fn().mockResolvedValue([account]),
    addAccount: vi.fn().mockResolvedValue(account),
    removeAccount: vi.fn().mockResolvedValue({ accountId, removed: true }),
    syncAccount: vi.fn().mockResolvedValue({
      account: account.account,
      counts: { inserted: 1, updated: 0, unchanged: 0 },
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
          body: "<b>Conteúdo externo</b>",
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
    ...overrides,
  };
}

function renderInbox(api = makeApi()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    api,
    ...render(
      <QueryClientProvider client={queryClient}>
        <InboxPage api={api} />
      </QueryClientProvider>,
    ),
  };
}

describe("InboxPage", () => {
  afterEach(cleanup);

  it("renders the focused inbox, selects a thread and marks it read only once", async () => {
    const { api } = renderInbox();
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeVisible();
    const item = await screen.findByRole("button", {
      name: /Proposta para landing page/,
    });
    await userEvent.click(item);

    expect(
      await screen.findByText("Ana Silva <ana@cliente.com>"),
    ).toBeVisible();
    expect(screen.getByText("<b>Conteúdo externo</b>")).toBeVisible();
    expect(
      screen.queryByText("Conteúdo externo", { selector: "b" }),
    ).toBeNull();
    expect(api.markThreadRead).toHaveBeenCalledTimes(1);

    await userEvent.click(item);
    expect(api.markThreadRead).toHaveBeenCalledTimes(1);
  });

  it("only synchronizes after an explicit account action", async () => {
    const { api } = renderInbox();
    expect(await screen.findByText("Projetos")).toBeVisible();
    expect(api.syncAccount).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Sincronizar Projetos" }),
    );
    expect(vi.mocked(api.syncAccount).mock.calls[0]?.[0]).toEqual({
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

  it("filters unread threads and confirms removal without invoking future actions", async () => {
    const { api } = renderInbox();
    await screen.findByText("Projetos");
    await userEvent.click(screen.getByRole("button", { name: "Não lidos" }));
    expect(api.listThreads).toHaveBeenLastCalledWith({
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

    await userEvent.click(
      screen.getByRole("button", { name: /Proposta para landing page/ }),
    );
    await screen.findByText("Ana Silva <ana@cliente.com>");

    for (const action of ["Virar tarefa", "Pedir rascunho", "Responder"]) {
      expect(screen.getByRole("button", { name: action })).toBeDisabled();
    }
  });

  it("removes a read thread from the unread cache", async () => {
    const { api } = renderInbox();
    await screen.findByText("Projetos");
    await userEvent.click(screen.getByRole("button", { name: "Não lidos" }));
    const item = await screen.findByRole("button", {
      name: /Proposta para landing page/,
    });
    await userEvent.click(item);

    expect(
      await screen.findByText("Ana Silva <ana@cliente.com>"),
    ).toBeVisible();
    expect(api.markThreadRead).toHaveBeenCalledTimes(1);
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
    expect(
      await screen.findByText("Ana Silva <ana@cliente.com>"),
    ).toBeVisible();

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
