import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { expect, it, vi } from "vitest";
import type { IpcChannel } from "../../shared/contracts/ipc";
import { createTestDatabase } from "../db/test-support";
import { RuntimeRegistry } from "../runtime/registry";
import { createAppState } from "./app-state";
import { registerIpcHandlers } from "./handlers";

vi.mock("electron", () => ({ dialog: {} }));

const accountId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
const threadId = "4d32d86d-3199-4327-9d0c-e283268ed239";
const now = "2026-07-21T12:00:00.000Z";
const account = {
  id: accountId,
  provider: "imap" as const,
  displayName: "Primary",
  address: "me@example.com",
  status: "connected" as const,
  syncCursor: null,
  lastError: null,
  lastSyncedAt: null,
  createdAt: now,
  updatedAt: now,
};

function harness() {
  const fixture = createTestDatabase();
  const state = createAppState({
    database: fixture.db,
    runtimes: new RuntimeRegistry(),
    createId: randomUUID,
    clock: () => new Date(now),
  });
  const inboxService = {
    listAccounts: vi.fn(async () => [
      {
        account,
        configuration: {
          host: "imap.example.com",
          port: 993,
          secure: true,
          mailbox: "INBOX",
          maxInitialMessages: 100,
          maxMessageBytes: 2_097_152,
        },
        hasCredential: true,
      },
    ]),
    addImapAccount: vi.fn(async () => ({
      account,
      configuration: {
        host: "imap.example.com",
        port: 993,
        secure: true,
        mailbox: "INBOX",
        maxInitialMessages: 100,
        maxMessageBytes: 2_097_152,
      },
      hasCredential: true,
    })),
    removeAccount: vi.fn(async () => ({ accountId, removed: true as const })),
    syncAccount: vi.fn(async () => ({
      account,
      counts: { inserted: 1, updated: 0, unchanged: 0 },
    })),
    listThreads: vi.fn(() => ({ threads: [], nextCursor: null })),
    getThread: vi.fn(() => ({
      thread: {
        id: threadId,
        accountId,
        externalThreadId: "x",
        subject: "Subject",
        snippet: "",
        participants: [],
        unreadCount: 1,
        lastMessageAt: now,
        labels: [],
        createdAt: now,
        updatedAt: now,
      },
      messages: [],
    })),
    markThreadRead: vi.fn(() => ({
      id: threadId,
      accountId,
      externalThreadId: "x",
      subject: "Subject",
      snippet: "",
      participants: [],
      unreadCount: 0,
      lastMessageAt: now,
      labels: [],
      createdAt: now,
      updatedAt: now,
    })),
  };
  const handlers = new Map<IpcChannel, Parameters<IpcMain["handle"]>[1]>();
  registerIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel as IpcChannel, handler);
      },
    },
    rendererUrl: "http://127.0.0.1:5173/index.html",
    state,
    clientCapabilities: async () => [],
    inboxService,
  });
  const senderFrame = { url: "http://127.0.0.1:5173/inbox" };
  const event = {
    senderFrame,
    sender: { mainFrame: senderFrame, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  return { handlers, inboxService, event };
}

it("routes all Inbox commands once and rejects invalid payloads before dispatch", async () => {
  const { handlers, inboxService, event } = harness();
  const add = {
    provider: "imap",
    displayName: "Primary",
    address: "me@example.com",
    configuration: { host: "imap.example.com", port: 993, secure: true },
    credential: {
      version: 1,
      kind: "imap_password",
      username: "me@example.com",
      password: "secret",
    },
  };
  await handlers.get("inbox:accounts:list")?.(event, {});
  await handlers.get("inbox:account:add")?.(event, add);
  await handlers.get("inbox:account:remove")?.(event, { accountId });
  await handlers.get("inbox:account:sync")?.(event, { accountId });
  await handlers.get("inbox:threads:list")?.(event, {
    unreadOnly: true,
    limit: 10,
  });
  await handlers.get("inbox:thread:get")?.(event, { threadId });
  await handlers.get("inbox:thread:markRead")?.(event, { threadId });
  expect(inboxService.listAccounts).toHaveBeenCalledOnce();
  expect(inboxService.addImapAccount).toHaveBeenCalledWith(add);
  expect(inboxService.removeAccount).toHaveBeenCalledWith(accountId);
  expect(inboxService.syncAccount).toHaveBeenCalledWith(accountId);
  expect(inboxService.listThreads).toHaveBeenCalledWith({
    unreadOnly: true,
    limit: 10,
  });
  expect(inboxService.getThread).toHaveBeenCalledWith(threadId);
  expect(inboxService.markThreadRead).toHaveBeenCalledWith(threadId);
  await expect(
    handlers.get("inbox:account:add")?.(event, { ...add, unexpected: true }),
  ).rejects.toThrow();
  expect(inboxService.addImapAccount).toHaveBeenCalledOnce();
});

it("rejects a response that leaks credential fields", async () => {
  const { handlers, inboxService, event } = harness();
  inboxService.listAccounts.mockResolvedValueOnce([
    {
      account,
      configuration: {
        host: "imap.example.com",
        port: 993,
        secure: true,
        mailbox: "INBOX",
        maxInitialMessages: 100,
        maxMessageBytes: 2_097_152,
      },
      hasCredential: true,
      credential: { password: "secret" },
    },
  ] as never);
  await expect(
    handlers.get("inbox:accounts:list")?.(event, {}),
  ).rejects.toThrow();
});
