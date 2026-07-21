import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../db/test-support";
import {
  InboxAccountNotFoundError,
  InboxAccountThreadMismatchError,
  InboxCursorConflictError,
  InboxInvalidInputError,
  InboxService,
} from "./service";

function createService() {
  const fx = createTestDatabase();
  return { fx, service: new InboxService(fx.db) };
}

function accountInput(overrides: Record<string, unknown> = {}) {
  return {
    provider: "gmail" as const,
    displayName: "Marcos",
    address: "marcos@example.com",
    ...overrides,
  };
}

function threadInput(overrides: Record<string, unknown> = {}) {
  return {
    externalThreadId: "thread-1",
    subject: "Sprint 4",
    snippet: "Inbox local",
    participants: ["Ana <ana@example.com>", "Marcos <marcos@example.com>"],
    unreadCount: 1,
    lastMessageAt: "2026-07-21T10:00:00.000Z",
    labels: ["inbox", "important"],
    ...overrides,
  };
}

function messageInput(overrides: Record<string, unknown> = {}) {
  return {
    externalMessageId: "message-1",
    threadExternalId: "thread-1",
    direction: "incoming" as const,
    sender: "ana@example.com",
    recipients: ["marcos@example.com", "ana@example.com"],
    body: "Oi",
    bodyFormat: "text" as const,
    sentAt: "2026-07-21T10:00:00.000Z",
    receivedAt: "2026-07-21T10:00:01.000Z",
    attachments: [{ filename: "brief.pdf", mimeType: "application/pdf" }],
    ...overrides,
  };
}

describe("InboxService", () => {
  it("normalizes account addresses per provider and exposes no credential fields", () => {
    const { fx, service } = createService();
    const gmail = service.addAccount(
      accountInput({ address: "  MARCOS@EXAMPLE.COM " }),
    );
    const outlook = service.addAccount(
      accountInput({ provider: "outlook", address: "marcos@example.com" }),
    );

    expect(gmail.address).toBe("marcos@example.com");
    expect(service.listAccounts()).toEqual([gmail, outlook]);
    expect(service.findAccount(gmail.id)).toEqual(gmail);
    expect(() =>
      service.addAccount(accountInput({ address: "marcos@example.com" })),
    ).toThrow(InboxInvalidInputError);
    expect(() => service.setAccountStatus("missing", "paused")).toThrow(
      InboxAccountNotFoundError,
    );

    const schema = fx.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'connector_accounts'",
      )
      .pluck()
      .get() as string;
    expect(schema).not.toMatch(
      /token|password|cookie|credential|secret|access_token|refresh_token/i,
    );
    expect(Object.keys(gmail).join(",")).not.toMatch(
      /token|password|cookie|credential|secret/i,
    );
  });

  it("applies an initial batch, advances its cursor, and treats canonical set payloads as unchanged", () => {
    const { service } = createService();
    const account = service.addAccount(accountInput());

    expect(
      service.applySyncBatch({
        accountId: account.id,
        previousCursor: null,
        nextCursor: "cursor-1",
        threads: [threadInput()],
        messages: [messageInput()],
        syncedAt: "2026-07-21T10:05:00.000Z",
      }),
    ).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
    expect(service.findAccount(account.id)).toMatchObject({
      syncCursor: "cursor-1",
      lastSyncedAt: "2026-07-21T10:05:00.000Z",
    });

    expect(
      service.applySyncBatch({
        accountId: account.id,
        previousCursor: "cursor-1",
        nextCursor: "cursor-2",
        threads: [
          threadInput({
            participants: [
              "Marcos <marcos@example.com>",
              "Ana <ana@example.com>",
            ],
            labels: ["important", "inbox"],
          }),
        ],
        messages: [
          messageInput({
            recipients: ["ana@example.com", "marcos@example.com"],
          }),
        ],
        syncedAt: "2026-07-21T10:06:00.000Z",
      }),
    ).toEqual({ inserted: 0, updated: 0, unchanged: 2 });

    expect(
      service.applySyncBatch({
        accountId: account.id,
        previousCursor: "cursor-2",
        nextCursor: "cursor-3",
        threads: [threadInput({ unreadCount: 0 })],
        messages: [messageInput({ body: "Atualizado" })],
        syncedAt: "2026-07-21T10:07:00.000Z",
      }),
    ).toEqual({ inserted: 0, updated: 2, unchanged: 0 });
  });

  it("replays a batch idempotently while allowing the same external IDs in another account", () => {
    const { fx, service } = createService();
    const first = service.addAccount(accountInput());
    const second = service.addAccount(
      accountInput({ address: "second@example.com" }),
    );
    const batch = {
      threads: [threadInput()],
      messages: [messageInput()],
      syncedAt: "2026-07-21T10:05:00.000Z",
    };

    service.applySyncBatch({
      accountId: first.id,
      previousCursor: null,
      nextCursor: "cursor-1",
      ...batch,
    });
    expect(
      service.applySyncBatch({
        accountId: first.id,
        previousCursor: "cursor-1",
        nextCursor: "cursor-1",
        ...batch,
      }),
    ).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    service.applySyncBatch({
      accountId: second.id,
      previousCursor: null,
      nextCursor: "cursor-1",
      ...batch,
    });

    expect(
      fx.db.prepare("SELECT count(*) FROM inbox_threads").pluck().get(),
    ).toBe(2);
    expect(
      fx.db.prepare("SELECT count(*) FROM inbox_messages").pluck().get(),
    ).toBe(2);
  });

  it("rolls back the entire batch for a stale cursor or an invalid cross-account thread", () => {
    const { service } = createService();
    const first = service.addAccount(accountInput());
    const second = service.addAccount(
      accountInput({ address: "second@example.com" }),
    );
    service.applySyncBatch({
      accountId: first.id,
      previousCursor: null,
      nextCursor: "cursor-1",
      threads: [threadInput()],
      messages: [messageInput()],
      syncedAt: "2026-07-21T10:05:00.000Z",
    });
    const firstThread = service.getThread(
      service.listThreads({ accountIds: [first.id] }).threads[0].id,
    ).thread;

    expect(() =>
      service.applySyncBatch({
        accountId: first.id,
        previousCursor: null,
        nextCursor: "stale",
        threads: [threadInput({ externalThreadId: "should-not-save" })],
        messages: [],
        syncedAt: "2026-07-21T10:06:00.000Z",
      }),
    ).toThrow(InboxCursorConflictError);
    expect(() =>
      service.applySyncBatch({
        accountId: second.id,
        previousCursor: null,
        nextCursor: "bad-thread",
        threads: [],
        messages: [
          messageInput({ externalMessageId: "bad", threadId: firstThread.id }),
        ],
        syncedAt: "2026-07-21T10:06:00.000Z",
      }),
    ).toThrow(InboxAccountThreadMismatchError);
    expect(service.findAccount(second.id)).toMatchObject({
      syncCursor: null,
      lastSyncedAt: null,
    });
    expect(
      service.listThreads({ accountIds: [first.id] }).threads,
    ).toHaveLength(1);
  });

  it("rejects attachment content instead of persisting binary data as metadata", () => {
    const { service } = createService();
    const account = service.addAccount(accountInput());

    expect(() =>
      service.applySyncBatch({
        accountId: account.id,
        previousCursor: null,
        nextCursor: "must-not-advance",
        threads: [threadInput()],
        messages: [
          messageInput({
            attachments: [
              {
                filename: "brief.pdf",
                mimeType: "application/pdf",
                content: Buffer.from("binary payload"),
              },
            ],
          }),
        ],
        syncedAt: "2026-07-21T10:06:00.000Z",
      }),
    ).toThrow(InboxInvalidInputError);
    expect(service.findAccount(account.id)).toMatchObject({
      syncCursor: null,
      lastSyncedAt: null,
    });
    expect(service.listThreads({ accountIds: [account.id] }).threads).toEqual(
      [],
    );
  });

  it("lists a stable combined inbox with unread filtering and local cursors", () => {
    const { service } = createService();
    const first = service.addAccount(accountInput());
    const second = service.addAccount(
      accountInput({ address: "second@example.com" }),
    );
    service.applySyncBatch({
      accountId: first.id,
      previousCursor: null,
      nextCursor: "first-1",
      threads: [
        threadInput({
          externalThreadId: "a",
          unreadCount: 0,
          lastMessageAt: "2026-07-21T09:00:00.000Z",
        }),
      ],
      messages: [],
      syncedAt: "2026-07-21T10:05:00.000Z",
    });
    service.applySyncBatch({
      accountId: second.id,
      previousCursor: null,
      nextCursor: "second-1",
      threads: [
        threadInput({
          externalThreadId: "b",
          unreadCount: 1,
          lastMessageAt: "2026-07-21T11:00:00.000Z",
        }),
        threadInput({
          externalThreadId: "c",
          unreadCount: 1,
          lastMessageAt: "2026-07-21T10:00:00.000Z",
        }),
      ],
      messages: [],
      syncedAt: "2026-07-21T11:05:00.000Z",
    });

    const firstPage = service.listThreads({ limit: 2 });
    expect(firstPage.threads.map((thread) => thread.externalThreadId)).toEqual([
      "b",
      "c",
    ]);
    expect(
      service
        .listThreads({ unreadOnly: true })
        .threads.map((thread) => thread.externalThreadId),
    ).toEqual(["b", "c"]);
    expect(
      service
        .listThreads({ cursor: firstPage.nextCursor ?? undefined })
        .threads.map((thread) => thread.externalThreadId),
    ).toEqual(["a"]);
  });

  it("returns ordered thread messages and marks a thread read idempotently without an outbox row", () => {
    const { fx, service } = createService();
    const account = service.addAccount(accountInput());
    service.applySyncBatch({
      accountId: account.id,
      previousCursor: null,
      nextCursor: "cursor-1",
      threads: [threadInput()],
      messages: [
        messageInput({
          externalMessageId: "later",
          sentAt: "2026-07-21T11:00:00.000Z",
        }),
        messageInput({
          externalMessageId: "earlier",
          sentAt: "2026-07-21T09:00:00.000Z",
        }),
      ],
      syncedAt: "2026-07-21T11:05:00.000Z",
    });
    const threadId = service.listThreads().threads[0].id;

    expect(
      service
        .getThread(threadId)
        .messages.map((message) => message.externalMessageId),
    ).toEqual(["earlier", "later"]);
    const marked = service.markThreadRead(threadId);
    expect(marked.unreadCount).toBe(0);
    expect(service.markThreadRead(threadId)).toEqual(marked);
    const unread = service.markThreadUnread(threadId);
    expect(unread.unreadCount).toBe(1);
    expect(service.markThreadUnread(threadId)).toEqual(unread);
    expect(
      fx.db.prepare("SELECT count(*) FROM external_outbox").pluck().get(),
    ).toBe(0);
  });
});
