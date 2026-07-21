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
  const sendTurn = vi.fn();
  state.laneService = { sendTurn } as unknown as typeof state.laneService;
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
  const inboxTaskActionService = {
    createKanbanTask: vi.fn(
      () =>
        ({
          actionId: "0f7c4f9c-33dd-4dbd-98cb-8e768646b386",
          sourceThreadId: threadId,
          card: {
            id: "94c8fd0f-708b-46b7-b929-852a92bc9437",
            taskId: null,
            title: "Subject",
            description: "Conteúdo externo não confiável",
            status: "backlog",
            ownerKind: "human",
            laneId: null,
            activationPolicy: "manual",
            position: 0,
            stateHash: "hash",
            lastProcessedHash: "hash",
            lastProcessedCursor: 1,
            createdAt: now,
            updatedAt: now,
          },
          executionStarted: false,
        }) as const,
    ),
  };
  const inboxReplyDraftService = {
    createReplyDraft: vi.fn(() => ({
      id: "0f7c4f9c-33dd-4dbd-98cb-8e768646b386",
      sourceThreadId: threadId,
      connectorAccountId: accountId,
      fromAddress: "me@example.com",
      to: ["client@example.com"] as string[],
      subject: "Re: Subject",
      body: "Thanks",
      status: "approval_pending" as const,
      requiresApproval: true as const,
      safeRetry: false as const,
      attempts: 0 as const,
      createdAt: now,
      updatedAt: now,
    })),
    listReplyActions: vi.fn(() => [
      {
        id: "0f7c4f9c-33dd-4dbd-98cb-8e768646b386",
        sourceThreadId: threadId,
        connectorAccountId: accountId,
        fromAddress: "me@example.com",
        to: ["client@example.com"],
        subject: "Re: Subject",
        body: "Thanks",
        status: "approval_pending" as const,
        requiresApproval: true,
        safeRetry: false,
        attempts: 0,
        approvedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
    ]),
    discardReplyAction: vi.fn(() => ({
      outboxId: "0f7c4f9c-33dd-4dbd-98cb-8e768646b386",
      sourceThreadId: threadId,
      discarded: true as const,
    })),
  };
  const inboxReplyGenerationService = {
    generateReplyDraft: vi.fn(async () => ({
      id: "0f7c4f9c-33dd-4dbd-98cb-8e768646b386",
      sourceThreadId: threadId,
      connectorAccountId: accountId,
      fromAddress: "me@example.com",
      to: ["client@example.com"] as string[],
      subject: "Re: Subject",
      body: "Generated reply",
      status: "approval_pending" as const,
      requiresApproval: true as const,
      safeRetry: false as const,
      attempts: 0 as const,
      createdAt: now,
      updatedAt: now,
    })),
  };
  const inboxOutgoingSettingsService = {
    get: vi.fn(() => ({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      fromAddresses: ["contato@example.com"],
      createdAt: now,
      updatedAt: now,
    })),
    save: vi.fn(() => ({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      fromAddresses: ["contato@example.com"],
      createdAt: now,
      updatedAt: now,
    })),
  };
  const inboxReplyDispatchService = {
    approveAndSend: vi.fn(async () => ({
      id: "0f7c4f9c-33dd-4dbd-98cb-8e768646b386",
      status: "confirmed" as const,
      attempts: 1,
      approvedAt: now,
      lastError: null,
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
    inboxTaskActionService,
    inboxReplyDraftService,
    inboxReplyGenerationService,
    inboxOutgoingSettingsService,
    inboxReplyDispatchService,
  });
  const senderFrame = { url: "http://127.0.0.1:5173/inbox" };
  const event = {
    senderFrame,
    sender: { mainFrame: senderFrame, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  return {
    handlers,
    inboxService,
    inboxTaskActionService,
    inboxReplyDraftService,
    inboxReplyGenerationService,
    inboxOutgoingSettingsService,
    inboxReplyDispatchService,
    event,
    sendTurn,
  };
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

it("creates a task through the strict trusted Inbox channel without starting a lane", async () => {
  const { handlers, inboxTaskActionService, event, sendTurn } = harness();
  const idempotencyKey = "f1db4f0c-a4ff-4fd2-9966-7fa6315d160d";

  await expect(
    handlers.get("inbox:thread:createTask")?.(event, {
      threadId,
      mode: "manual",
      laneId: null,
      idempotencyKey,
    }),
  ).resolves.toMatchObject({
    executionStarted: false,
    sourceThreadId: threadId,
  });
  expect(inboxTaskActionService.createKanbanTask).toHaveBeenCalledOnce();
  expect(inboxTaskActionService.createKanbanTask).toHaveBeenCalledWith({
    threadId,
    mode: "manual",
    laneId: null,
    idempotencyKey,
  });
  expect(sendTurn).not.toHaveBeenCalled();
  await expect(
    handlers.get("inbox:thread:createTask")?.(event, {
      threadId,
      mode: "delegate",
      laneId: null,
      idempotencyKey,
    }),
  ).rejects.toThrow();
  expect(inboxTaskActionService.createKanbanTask).toHaveBeenCalledOnce();

  const untrustedEvent = {
    senderFrame: { url: "https://evil.example/inbox" },
    sender: { mainFrame: { url: "https://evil.example/inbox" }, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  await expect(
    handlers.get("inbox:thread:createTask")?.(untrustedEvent, {
      unexpected: true,
    }),
  ).rejects.toThrow("Untrusted renderer origin");
  expect(inboxTaskActionService.createKanbanTask).toHaveBeenCalledOnce();
});

it("creates an approval-pending reply draft through the strict trusted Inbox channel", async () => {
  const { handlers, inboxReplyDraftService, event, sendTurn } = harness();
  const idempotencyKey = "f1db4f0c-a4ff-4fd2-9966-7fa6315d160d";

  await expect(
    handlers.get("inbox:thread:createReplyDraft")?.(event, {
      threadId,
      body: "  Thanks  ",
      idempotencyKey,
    }),
  ).resolves.toMatchObject({
    sourceThreadId: threadId,
    status: "approval_pending",
    requiresApproval: true,
    safeRetry: false,
    attempts: 0,
  });
  expect(inboxReplyDraftService.createReplyDraft).toHaveBeenCalledOnce();
  expect(inboxReplyDraftService.createReplyDraft).toHaveBeenCalledWith({
    threadId,
    body: "Thanks",
    idempotencyKey,
  });
  expect(sendTurn).not.toHaveBeenCalled();
  await expect(
    handlers.get("inbox:thread:createReplyDraft")?.(event, {
      threadId,
      body: "   ",
      idempotencyKey,
    }),
  ).rejects.toThrow();
  expect(inboxReplyDraftService.createReplyDraft).toHaveBeenCalledOnce();

  const untrustedEvent = {
    senderFrame: { url: "https://evil.example/inbox" },
    sender: { mainFrame: { url: "https://evil.example/inbox" }, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  await expect(
    handlers.get("inbox:thread:createReplyDraft")?.(untrustedEvent, {
      unexpected: true,
    }),
  ).rejects.toThrow("Untrusted renderer origin");
  expect(inboxReplyDraftService.createReplyDraft).toHaveBeenCalledOnce();
});

it("generates a reply draft only through the strict trusted Inbox channel", async () => {
  const { handlers, inboxReplyGenerationService, event } = harness();

  await expect(
    handlers.get("inbox:thread:generateReplyDraft")?.(event, {
      threadId,
      runtimeKind: "codex",
      model: "gpt-test",
      effort: "low",
    }),
  ).resolves.toMatchObject({
    sourceThreadId: threadId,
    body: "Generated reply",
    status: "approval_pending",
    requiresApproval: true,
    safeRetry: false,
  });
  expect(inboxReplyGenerationService.generateReplyDraft).toHaveBeenCalledOnce();
  const generationCall = (
    inboxReplyGenerationService.generateReplyDraft.mock
      .calls as unknown as Array<[unknown, unknown]>
  )[0]!;
  expect(generationCall[0]).toEqual({
    threadId,
    runtimeKind: "codex",
    model: "gpt-test",
    effort: "low",
  });
  expect(generationCall[1]).toEqual({ onEvent: expect.any(Function) });

  await expect(
    handlers.get("inbox:thread:generateReplyDraft")?.(event, {
      threadId,
      runtimeKind: "codex",
      model: "x".repeat(121),
    }),
  ).rejects.toThrow();
  expect(inboxReplyGenerationService.generateReplyDraft).toHaveBeenCalledOnce();

  inboxReplyGenerationService.generateReplyDraft.mockResolvedValueOnce(
    {} as never,
  );
  await expect(
    handlers.get("inbox:thread:generateReplyDraft")?.(event, {
      threadId,
      runtimeKind: "codex",
      model: "gpt-test",
    }),
  ).rejects.toThrow();
  expect(inboxReplyGenerationService.generateReplyDraft).toHaveBeenCalledTimes(
    2,
  );

  const untrustedEvent = {
    senderFrame: { url: "https://evil.example/inbox" },
    sender: { mainFrame: { url: "https://evil.example/inbox" }, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  await expect(
    handlers.get("inbox:thread:generateReplyDraft")?.(untrustedEvent, {
      threadId,
      runtimeKind: "codex",
      model: "gpt-test",
    }),
  ).rejects.toThrow("Untrusted renderer origin");
  expect(inboxReplyGenerationService.generateReplyDraft).toHaveBeenCalledTimes(
    2,
  );
});

it("lists only the strict public reply-action surface for a trusted thread", async () => {
  const { handlers, inboxReplyDraftService, event } = harness();

  await expect(
    handlers.get("inbox:thread:replyActions:list")?.(event, { threadId }),
  ).resolves.toEqual([
    expect.objectContaining({
      sourceThreadId: threadId,
      approvedAt: null,
      lastError: null,
    }),
  ]);
  expect(inboxReplyDraftService.listReplyActions).toHaveBeenCalledWith(
    threadId,
  );

  inboxReplyDraftService.listReplyActions.mockReturnValueOnce([
    {
      ...inboxReplyDraftService.listReplyActions.mock.results[0]?.value[0],
      idempotencyKey: "secret",
    },
  ]);
  await expect(
    handlers.get("inbox:thread:replyActions:list")?.(event, { threadId }),
  ).rejects.toThrow();
});

it("routes strict trusted outgoing settings requests without exposing credentials", async () => {
  const { handlers, inboxOutgoingSettingsService, event } = harness();

  await expect(
    handlers.get("inbox:account:outgoing:get")?.(event, { accountId }),
  ).resolves.toEqual({
    host: "smtp.example.com",
    port: 587,
    secure: false,
    fromAddresses: ["contato@example.com"],
    createdAt: now,
    updatedAt: now,
  });
  await expect(
    handlers.get("inbox:account:outgoing:set")?.(event, {
      accountId,
      configuration: {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        fromAddresses: ["financeiro@example.com"],
      },
    }),
  ).resolves.toMatchObject({ host: "smtp.example.com", secure: true });
  expect(inboxOutgoingSettingsService.get).toHaveBeenCalledWith(accountId);
  expect(inboxOutgoingSettingsService.save).toHaveBeenCalledWith({
    accountId,
    host: "smtp.example.com",
    port: 465,
    secure: true,
    fromAddresses: ["financeiro@example.com"],
  });
  await expect(
    handlers.get("inbox:account:outgoing:set")?.(event, {
      accountId,
      configuration: {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        password: "secret",
      },
    }),
  ).rejects.toThrow();
  expect(inboxOutgoingSettingsService.save).toHaveBeenCalledOnce();

  const untrustedEvent = {
    senderFrame: { url: "https://evil.example/inbox" },
    sender: { mainFrame: { url: "https://evil.example/inbox" }, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  await expect(
    handlers.get("inbox:account:outgoing:get")?.(untrustedEvent, {
      accountId,
    }),
  ).rejects.toThrow("Untrusted renderer origin");
  expect(inboxOutgoingSettingsService.get).toHaveBeenCalledOnce();
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

it("requires explicit reply-send confirmation before dispatch and rejects credential leaks", async () => {
  const { handlers, inboxReplyDispatchService, event } = harness();
  const outboxId = "0f7c4f9c-33dd-4dbd-98cb-8e768646b386";

  await expect(
    handlers.get("inbox:reply:approveAndSend")?.(event, { outboxId }),
  ).rejects.toThrow();
  await expect(
    handlers.get("inbox:reply:approveAndSend")?.(event, {
      outboxId,
      confirmation: "send_now",
    }),
  ).rejects.toThrow();
  expect(inboxReplyDispatchService.approveAndSend).not.toHaveBeenCalled();

  await expect(
    handlers.get("inbox:reply:approveAndSend")?.(event, {
      outboxId,
      confirmation: "approve_and_send",
    }),
  ).resolves.toEqual({
    id: outboxId,
    status: "confirmed",
    attempts: 1,
    approvedAt: now,
    lastError: null,
  });
  expect(inboxReplyDispatchService.approveAndSend).toHaveBeenCalledWith(
    outboxId,
  );

  inboxReplyDispatchService.approveAndSend.mockResolvedValueOnce({
    id: outboxId,
    status: "confirmed",
    attempts: 1,
    approvedAt: now,
    lastError: null,
    credential: { password: "secret" },
  } as never);
  await expect(
    handlers.get("inbox:reply:approveAndSend")?.(event, {
      outboxId,
      confirmation: "approve_and_send",
    }),
  ).rejects.toThrow();
});

it("requires explicit confirmation before discarding an unsent reply", async () => {
  const { handlers, inboxReplyDraftService, event } = harness();
  const outboxId = "0f7c4f9c-33dd-4dbd-98cb-8e768646b386";

  await expect(
    handlers.get("inbox:reply:discard")?.(event, { outboxId, threadId }),
  ).rejects.toThrow();
  await expect(
    handlers.get("inbox:reply:discard")?.(event, {
      outboxId,
      threadId,
      confirmation: "discard_unsent_draft",
    }),
  ).resolves.toEqual({ outboxId, sourceThreadId: threadId, discarded: true });
  expect(inboxReplyDraftService.discardReplyAction).toHaveBeenCalledWith(
    threadId,
    outboxId,
  );
});
