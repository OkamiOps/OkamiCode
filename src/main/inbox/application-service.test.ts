import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../db/test-support";
import type { ConnectorCredential } from "../connectors/credential-vault";
import type { ApplyInboxSyncBatch } from "./service";
import {
  InboxApplicationError,
  InboxApplicationService,
  type CredentialVault,
  type ImapMessageMover,
  type ImapReadStateUpdater,
  type ImapSyncer,
} from "./application-service";
import { ImapSyncError } from "./imap-adapter";

const credential: ConnectorCredential = {
  version: 1,
  kind: "imap_password",
  username: "marcos@example.com",
  password: "do-not-persist-this",
};

class MemoryVault implements CredentialVault {
  readonly credentials = new Map<string, ConnectorCredential>();
  readonly calls: string[] = [];
  failSet = false;
  failHas = false;
  failDelete = false;

  async set(id: string, value: ConnectorCredential): Promise<void> {
    this.calls.push(`set:${id}`);
    if (this.failSet) throw new Error("vault set secret failure");
    this.credentials.set(id, value);
  }

  async get(id: string): Promise<ConnectorCredential | null> {
    this.calls.push(`get:${id}`);
    return this.credentials.get(id) ?? null;
  }

  async has(id: string): Promise<boolean> {
    this.calls.push(`has:${id}`);
    if (this.failHas) throw new Error("vault has secret failure");
    return this.credentials.has(id);
  }

  async delete(id: string): Promise<void> {
    this.calls.push(`delete:${id}`);
    if (this.failDelete) throw new Error("vault delete secret failure");
    this.credentials.delete(id);
  }
}

function batch(accountId: string): ApplyInboxSyncBatch {
  return {
    accountId,
    previousCursor: null,
    nextCursor: "cursor-1",
    syncedAt: "2026-07-21T12:00:00.000Z",
    threads: [
      {
        externalThreadId: "thread-1",
        subject: "Hello",
        snippet: "hello",
        participants: ["ana@example.com", "marcos@example.com"],
        unreadCount: 1,
        lastMessageAt: "2026-07-21T12:00:00.000Z",
        labels: ["inbox"],
      },
    ],
    messages: [
      {
        externalMessageId: "message-1",
        threadExternalId: "thread-1",
        direction: "incoming",
        sender: "ana@example.com",
        recipients: ["marcos@example.com"],
        body: "hello",
        bodyFormat: "text",
        sentAt: null,
        receivedAt: "2026-07-21T12:00:00.000Z",
        attachments: [],
      },
    ],
  };
}

function fixture(
  adapter?: ImapSyncer & Partial<ImapMessageMover & ImapReadStateUpdater>,
) {
  const fx = createTestDatabase();
  const vault = new MemoryVault();
  const adapterCalls: string[] = [];
  const service = new InboxApplicationService({
    db: fx.db,
    vault,
    createAdapter: () =>
      adapter ?? {
        sync: async (input) => {
          adapterCalls.push(input.account.id);
          return batch(input.account.id);
        },
      },
    createId: (() => {
      let sequence = 0;
      return () => `account-${++sequence}`;
    })(),
    clock: () => new Date("2026-07-21T11:00:00.000Z"),
  });
  return { fx, vault, service, adapterCalls };
}

function addInput(overrides: Record<string, unknown> = {}) {
  return {
    provider: "imap" as const,
    displayName: "Titan mailbox",
    address: "MARCOS@EXAMPLE.COM",
    configuration: {
      host: " mail.example.com ",
      port: 993,
      secure: true,
    },
    credential,
    ...overrides,
  };
}

describe("InboxApplicationService", () => {
  it("marks every provider message unseen before updating the local thread", async () => {
    const setMessagesSeen = vi.fn().mockResolvedValue(undefined);
    const { service } = fixture({
      sync: async (input: { account: { id: string } }) =>
        batch(input.account.id),
      setMessagesSeen,
    } as never);
    const added = await service.addImapAccount(addInput());
    await service.syncAccount(added.account.id);
    const selected = service.listThreads().threads[0]!;
    service.markThreadRead(selected.id);

    await expect(service.markThreadUnread(selected.id)).resolves.toMatchObject({
      id: selected.id,
      unreadCount: 1,
    });
    expect(setMessagesSeen).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ id: added.account.id }),
        externalMessageIds: ["message-1"],
        seen: false,
      }),
    );
  });

  it("keeps a read thread local when marking it unseen fails remotely", async () => {
    const { service } = fixture({
      sync: async (input: { account: { id: string } }) =>
        batch(input.account.id),
      setMessagesSeen: vi.fn().mockRejectedValue(new ImapSyncError()),
    } as never);
    const added = await service.addImapAccount(addInput());
    await service.syncAccount(added.account.id);
    const selected = service.listThreads().threads[0]!;
    service.markThreadRead(selected.id);

    await expect(service.markThreadUnread(selected.id)).rejects.toThrow(
      "Não foi possível marcar a conversa como não lida.",
    );
    expect(service.getThread(selected.id).thread.unreadCount).toBe(0);
  });

  it("moves every message in a thread remotely before removing the local conversation", async () => {
    const moveMessages = vi.fn().mockResolvedValue(undefined);
    const { service } = fixture({
      sync: async (input) => batch(input.account.id),
      moveMessages,
    });
    const added = await service.addImapAccount(addInput());
    await service.syncAccount(added.account.id);
    const selected = service.listThreads().threads[0];

    await expect(service.moveThread(selected!.id, "trash")).resolves.toEqual({
      threadId: selected!.id,
      destination: "trash",
      moved: true,
    });
    expect(moveMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ id: added.account.id }),
        externalMessageIds: ["message-1"],
        destination: "trash",
      }),
    );
    expect(service.listThreads().threads).toEqual([]);
  });

  it("serializes rapid remote moves for the same mailbox", async () => {
    let active = 0;
    let maximumActive = 0;
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const firstStartedPromise = new Promise<void>(
      (resolve) => (firstStarted = resolve),
    );
    const releaseFirstPromise = new Promise<void>(
      (resolve) => (releaseFirst = resolve),
    );
    const moveMessages = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (moveMessages.mock.calls.length === 1) {
        firstStarted?.();
        await releaseFirstPromise;
      }
      active -= 1;
    });
    const { service } = fixture({
      sync: async (input) => {
        const first = batch(input.account.id);
        return {
          ...first,
          threads: [
            ...first.threads,
            {
              ...first.threads[0]!,
              externalThreadId: "thread-2",
              subject: "Second",
            },
          ],
          messages: [
            ...first.messages,
            {
              ...first.messages[0]!,
              externalMessageId: "message-2",
              threadExternalId: "thread-2",
            },
          ],
        };
      },
      moveMessages,
    });
    const added = await service.addImapAccount(addInput());
    await service.syncAccount(added.account.id);
    const [first, second] = service.listThreads().threads;

    const firstMove = service.moveThread(first!.id, "trash");
    const secondMove = service.moveThread(second!.id, "trash");
    await firstStartedPromise;

    expect(moveMessages).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    await expect(Promise.all([firstMove, secondMove])).resolves.toHaveLength(2);
    expect(moveMessages).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
    expect(service.listThreads().threads).toEqual([]);
  });

  it("keeps the local conversation when the remote move fails", async () => {
    const { service } = fixture({
      sync: async (input) => batch(input.account.id),
      moveMessages: vi.fn().mockRejectedValue(new ImapSyncError()),
    });
    const added = await service.addImapAccount(addInput());
    await service.syncAccount(added.account.id);
    const selected = service.listThreads().threads[0];

    await expect(service.moveThread(selected!.id, "spam")).rejects.toThrow(
      "Não foi possível mover a conversa para spam.",
    );
    expect(service.listThreads().threads).toHaveLength(1);
  });

  it("recovers an orphaned syncing status when the desktop service restarts", async () => {
    const { fx, service, vault } = fixture();
    const added = await service.addImapAccount(addInput());
    fx.db
      .prepare(
        `UPDATE connector_accounts
            SET status = 'syncing', last_error = NULL
          WHERE id = ?`,
      )
      .run(added.account.id);

    const restarted = new InboxApplicationService({
      db: fx.db,
      vault,
      createAdapter: () => ({
        sync: async (input) => batch(input.account.id),
      }),
      createId: () => "unused-account-id",
      clock: () => new Date("2026-07-21T11:05:00.000Z"),
    });

    await expect(restarted.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        account: expect.objectContaining({
          status: "degraded",
          lastError: "Sincronização interrompida. Tente novamente.",
        }),
      }),
    ]);
  });

  it("adds a sanitized account with normalized default configuration and never writes its secret to SQLite", async () => {
    const { fx, service, vault } = fixture();

    const added = await service.addImapAccount(addInput());

    expect(added).toMatchObject({
      account: {
        id: "account-1",
        status: "connected",
        address: "marcos@example.com",
      },
      configuration: {
        host: "mail.example.com",
        port: 993,
        secure: true,
        mailbox: "INBOX",
        maxInitialMessages: 100,
        maxMessageBytes: 2 * 1024 * 1024,
      },
      hasCredential: true,
    });
    expect(vault.credentials.get("account-1")).toEqual(credential);
    expect(
      JSON.stringify(
        fx.db.prepare("SELECT * FROM inbox_account_settings").all(),
      ),
    ).not.toContain("do-not-persist-this");
    expect(JSON.stringify(added)).not.toContain("do-not-persist-this");
  });

  it("provisions the official SMTP endpoint when a Hostinger mailbox is connected", async () => {
    const { fx, service } = fixture();

    await service.addImapAccount(
      addInput({
        configuration: {
          host: "imap.hostinger.com",
          port: 993,
          secure: true,
        },
      }),
    );

    expect(
      fx.db
        .prepare(
          `SELECT host, port, secure, from_addresses_json
             FROM inbox_outgoing_settings
            WHERE account_id = 'account-1'`,
        )
        .get(),
    ).toEqual({
      host: "smtp.hostinger.com",
      port: 465,
      secure: 1,
      from_addresses_json: "[]",
    });
  });

  it("keeps legacy Gmail credentials compatible with the official SMTP endpoint", async () => {
    const { fx, service, vault } = fixture();

    const added = await service.addImapAccount(
      addInput({
        provider: "gmail",
        displayName: "Gmail pessoal",
        address: "marcos@gmail.com",
        configuration: {
          host: "imap.gmail.com",
          port: 993,
          secure: true,
        },
        credential: {
          version: 1,
          kind: "imap_password",
          username: "marcos@gmail.com",
          password: "abcd efgh ijkl mnop",
        },
      }) as never,
    );

    expect(added.account).toMatchObject({
      provider: "gmail",
      address: "marcos@gmail.com",
    });
    expect(vault.credentials.get("account-1")).toEqual({
      version: 1,
      kind: "imap_password",
      username: "marcos@gmail.com",
      password: "abcdefghijklmnop",
    });
    expect(
      fx.db
        .prepare(
          `SELECT host, port, secure
             FROM inbox_outgoing_settings
            WHERE account_id = 'account-1'`,
        )
        .get(),
    ).toEqual({ host: "smtp.gmail.com", port: 465, secure: 1 });
  });

  it("updates a legacy Gmail credential without recreating the account", async () => {
    const { service, vault } = fixture();
    const added = await service.addImapAccount(
      addInput({
        provider: "gmail",
        address: "marcos@gmail.com",
        configuration: {
          host: "imap.gmail.com",
          port: 993,
          secure: true,
        },
      }) as never,
    );

    await expect(
      service.updateCredentialAndSync(added.account.id, {
        version: 1,
        kind: "imap_password",
        username: "marcos@gmail.com",
        password: "abcd efgh ijkl mnop",
      }),
    ).resolves.toMatchObject({ account: { status: "connected" } });
    expect(vault.credentials.get(added.account.id)).toEqual({
      version: 1,
      kind: "imap_password",
      username: "marcos@gmail.com",
      password: "abcdefghijklmnop",
    });
  });

  it("passes calendar invitations from synchronized email to the calendar importer", async () => {
    const imported = vi.fn();
    const fx = createTestDatabase();
    const vault = new MemoryVault();
    const service = new InboxApplicationService({
      db: fx.db,
      vault,
      createAdapter: () => ({
        sync: async (input) => ({
          ...batch(input.account.id),
          calendarInvitations: [
            {
              externalMessageId: "message-1",
              payload: "BEGIN:VCALENDAR\nEND:VCALENDAR",
            },
          ],
        }),
      }),
      calendarInvitations: { import: imported },
      createId: () => "account-1",
      clock: () => new Date("2026-07-21T11:00:00.000Z"),
    });
    const added = await service.addImapAccount(addInput());

    await service.syncAccount(added.account.id);

    expect(imported).toHaveBeenCalledWith({
      accountId: "account-1",
      accountDisplayName: "Titan mailbox",
      accountAddress: "marcos@example.com",
      invitations: [
        {
          externalMessageId: "message-1",
          payload: "BEGIN:VCALENDAR\nEND:VCALENDAR",
        },
      ],
      syncedAt: "2026-07-21T12:00:00.000Z",
    });
  });

  it("keeps SQLite empty when the vault fails and compensates the vault when SQLite rejects the account", async () => {
    const { fx, service, vault } = fixture();
    vault.failSet = true;

    await expect(service.addImapAccount(addInput())).rejects.toBeInstanceOf(
      InboxApplicationError,
    );
    expect(
      fx.db.prepare("SELECT count(*) FROM connector_accounts").pluck().get(),
    ).toBe(0);

    vault.failSet = false;
    await service.addImapAccount(addInput());
    await expect(service.addImapAccount(addInput())).rejects.toBeInstanceOf(
      InboxApplicationError,
    );
    expect(vault.credentials.has("account-3")).toBe(false);
  });

  it("lists only credential presence through has and surfaces a vault failure instead of inventing false", async () => {
    const { service, vault } = fixture();
    await service.addImapAccount(addInput());
    vault.calls.length = 0;

    await expect(service.listAccounts()).resolves.toEqual([
      expect.objectContaining({ hasCredential: true }),
    ]);
    expect(vault.calls).toEqual(["has:account-1"]);
    vault.failHas = true;
    await expect(service.listAccounts()).rejects.toBeInstanceOf(
      InboxApplicationError,
    );
  });

  it("removes the secret before cascading account data and preserves the account if vault removal fails", async () => {
    const { fx, service, vault } = fixture();
    const added = await service.addImapAccount(addInput());
    await service.syncAccount(added.account.id);
    vault.failDelete = true;

    await expect(
      service.removeAccount(added.account.id),
    ).rejects.toBeInstanceOf(InboxApplicationError);
    expect(
      fx.db.prepare("SELECT count(*) FROM connector_accounts").pluck().get(),
    ).toBe(1);
    vault.failDelete = false;
    await expect(service.removeAccount(added.account.id)).resolves.toEqual({
      accountId: added.account.id,
      removed: true,
    });
    expect(
      fx.db.prepare("SELECT count(*) FROM inbox_threads").pluck().get(),
    ).toBe(0);
    expect(
      fx.db
        .prepare("SELECT count(*) FROM inbox_account_settings")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("applies a successful sync and delegates thread reads and local mutations to InboxService", async () => {
    const { service } = fixture();
    const added = await service.addImapAccount(addInput());

    await expect(service.syncAccount(added.account.id)).resolves.toMatchObject({
      account: { status: "connected", syncCursor: "cursor-1", lastError: null },
      counts: { inserted: 2, updated: 0, unchanged: 0 },
    });
    const thread = service.listThreads().threads[0];
    expect(service.getThread(thread.id).messages).toHaveLength(1);
    expect(service.markThreadRead(thread.id).unreadCount).toBe(0);
  });

  it("marks a credential-less account auth_required without creating an adapter", async () => {
    const { service, vault, adapterCalls } = fixture();
    const added = await service.addImapAccount(addInput());
    vault.credentials.delete(added.account.id);

    await expect(service.syncAccount(added.account.id)).rejects.toBeInstanceOf(
      InboxApplicationError,
    );
    expect(adapterCalls).toEqual([]);
    await expect(service.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        account: expect.objectContaining({ status: "auth_required" }),
      }),
    ]);
  });

  it("preserves an actionable Gmail authentication error and marks the account auth_required", async () => {
    const message =
      "O Gmail recusou a conexão antiga. Reconecte a conta usando Entrar com Google.";
    const { service } = fixture({
      sync: vi
        .fn()
        .mockRejectedValue(new ImapSyncError(message, "auth_required")),
    });
    const added = await service.addImapAccount(
      addInput({
        provider: "gmail",
        address: "marcos@gmail.com",
        configuration: {
          host: "imap.gmail.com",
          port: 993,
          secure: true,
        },
      }) as never,
    );

    await expect(service.syncAccount(added.account.id)).rejects.toMatchObject({
      message,
    });
    await expect(service.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        account: expect.objectContaining({
          status: "auth_required",
          lastError: message,
        }),
      }),
    ]);
  });

  it("marks a vault availability failure degraded without exposing its internals", async () => {
    const { fx, service, vault } = fixture();
    const added = await service.addImapAccount(addInput());
    vault.failHas = true;

    await expect(service.syncAccount(added.account.id)).rejects.toMatchObject({
      message: expect.not.stringContaining("secret failure"),
    });
    expect(
      fx.db
        .prepare(
          "SELECT status, last_error FROM connector_accounts WHERE id = ?",
        )
        .get(added.account.id),
    ).toEqual({
      status: "degraded",
      last_error: "Synchronization failed. Please try again.",
    });
  });

  it("sanitizes sync failure, records degraded state, deduplicates an in-flight account, permits other accounts, and retries", async () => {
    let release: (() => void) | undefined;
    let attempts = 0;
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const sync: ImapSyncer = {
      sync: async (input) => {
        attempts += 1;
        if (attempts === 1) throw new Error(`secret ${input.account.address}`);
        if (attempts === 2) {
          started?.();
          await new Promise<void>((resolve) => (release = resolve));
        }
        return batch(input.account.id);
      },
    };
    const { service } = fixture(sync);
    const first = await service.addImapAccount(addInput());
    const second = await service.addImapAccount(
      addInput({ address: "other@example.com" }),
    );

    await expect(service.syncAccount(first.account.id)).rejects.toMatchObject({
      message: expect.not.stringContaining("marcos@example.com"),
    });
    await expect(service.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        account: expect.objectContaining({ status: "degraded" }),
      }),
      expect.any(Object),
    ]);

    const retry = service.syncAccount(first.account.id);
    const duplicate = service.syncAccount(first.account.id);
    const independent = service.syncAccount(second.account.id);
    await startedPromise;
    release?.();
    await expect(
      Promise.all([retry, duplicate, independent]),
    ).resolves.toHaveLength(3);
    expect(attempts).toBe(3);
  });
});
