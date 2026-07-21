import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ConnectorCredential } from "../connectors/credential-vault";
import { createTestDatabase } from "../db/test-support";
import { InboxOutgoingSettingsService } from "./outgoing-settings-service";
import { ReplyDispatchService } from "./reply-dispatch-service";
import { InboxService } from "./service";
import { ExternalOutboxService } from "../outbox/service";
import type { SmtpReplyTransport } from "./smtp-transport";

const now = "2026-07-21T12:00:00.000Z";

function fixture(
  options: {
    credential?: ConnectorCredential | null;
    settings?: boolean;
    transport?: SmtpReplyTransport;
    settingsValue?: unknown;
    fromAddress?: string;
    fromAddresses?: string[];
    transportFactory?: { create: (input: unknown) => SmtpReplyTransport };
    kind?: "email.reply" | "email.forward";
  } = {},
) {
  const database = createTestDatabase();
  const inbox = new InboxService(database.db);
  const account = inbox.addAccount({
    provider: "imap",
    displayName: "Primary",
    address: "me@example.com",
  });
  if (options.settings !== false) {
    new InboxOutgoingSettingsService({
      db: database.db,
      clock: () => now,
    }).save({
      accountId: account.id,
      host: "smtp.example.com",
      port: 587,
      secure: false,
      fromAddresses: options.fromAddresses,
    });
  }
  const outbox = new ExternalOutboxService(database.db);
  const kind = options.kind ?? "email.reply";
  const draft = outbox.createDraft({
    connectorAccountId: account.id,
    kind,
    payload:
      kind === "email.reply"
        ? {
            threadId: randomUUID(),
            externalThreadId: "thread-1",
            inReplyTo: "<incoming@example.com>",
            to: ["client@example.com"],
            subject: "Re: Proposal",
            body: "Thanks, I will send it tomorrow.",
            ...(options.fromAddress
              ? { fromAddress: options.fromAddress }
              : {}),
          }
        : {
            threadId: randomUUID(),
            externalThreadId: "thread-1",
            sourceMessageId: "<incoming@example.com>",
            to: ["lead@example.com", "finance@example.com"],
            subject: "Enc: Proposal",
            body: "Forwarded message",
            note: "",
            ...(options.fromAddress
              ? { fromAddress: options.fromAddress }
              : {}),
          },
    idempotencyKey: randomUUID(),
    requiresApproval: true,
    safeRetry: false,
  });
  const pending = outbox.requestApproval(draft.id);
  const transport = options.transport ?? {
    send: vi.fn(async () => ({
      messageId: "<sent@example.com>",
      acceptedCount: 1,
      rejectedCount: 0,
    })),
  };
  const vault = {
    get: vi.fn(async () =>
      options.credential === undefined
        ? {
            version: 1 as const,
            kind: "imap_password" as const,
            username: "me@example.com",
            password: "secret",
          }
        : options.credential,
    ),
  };
  const transportFactory =
    options.transportFactory ?? ({ create: vi.fn(() => transport) } as const);
  const service = new ReplyDispatchService({
    db: database.db,
    vault,
    outgoingSettings: {
      get: vi.fn(() =>
        options.settingsValue === undefined
          ? options.settings === false
            ? null
            : new InboxOutgoingSettingsService({ db: database.db }).get(
                account.id,
              )
          : options.settingsValue,
      ) as never,
    },
    transportFactory,
  });
  return {
    database,
    account,
    outbox,
    pending,
    transport,
    vault,
    service,
    transportFactory,
  };
}

describe("ReplyDispatchService", () => {
  it("preflights, approves, claims, sends and confirms an explicit reply", async () => {
    const { outbox, pending, service, transport } = fixture();

    await expect(service.approveAndSend(pending.id)).resolves.toEqual({
      id: pending.id,
      status: "confirmed",
      attempts: 1,
      approvedAt: expect.any(String),
      lastError: null,
    });
    expect(transport.send).toHaveBeenCalledWith({
      from: "me@example.com",
      to: ["client@example.com"],
      subject: "Re: Proposal",
      text: "Thanks, I will send it tomorrow.",
      inReplyTo: "<incoming@example.com>",
      references: "<incoming@example.com>",
    });
    expect(outbox.findById(pending.id)).toMatchObject({
      status: "confirmed",
      attempts: 1,
      providerReceipt: {
        messageId: "<sent@example.com>",
        acceptedCount: 1,
        rejectedCount: 0,
      },
    });
  });

  it("sends with a configured alias and rejects a forged sender before claiming", async () => {
    const allowed = fixture({
      fromAddress: "propostas@example.com",
      fromAddresses: ["propostas@example.com"],
    });
    await allowed.service.approveAndSend(allowed.pending.id);
    expect(allowed.transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "propostas@example.com" }),
    );

    const forged = fixture({
      fromAddress: "forged@example.com",
      fromAddresses: ["propostas@example.com"],
    });
    await expect(
      forged.service.approveAndSend(forged.pending.id),
    ).rejects.toThrow("Reply dispatch is unavailable");
    expect(forged.outbox.findById(forged.pending.id)).toMatchObject({
      status: "approval_pending",
      attempts: 0,
    });
    expect(forged.transport.send).not.toHaveBeenCalled();
  });

  it("sends a forward without reply-thread headers", async () => {
    const { pending, service, transport } = fixture({
      kind: "email.forward",
    });

    await expect(service.approveAndSend(pending.id)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(transport.send).toHaveBeenCalledWith({
      from: "me@example.com",
      to: ["lead@example.com", "finance@example.com"],
      subject: "Enc: Proposal",
      text: "Forwarded message",
    });
  });

  it.each([
    ["missing SMTP settings", { settings: false }],
    ["missing credential", { credential: null }],
  ])("fails closed for %s without a claim or send", async (_name, options) => {
    const { outbox, pending, service, transport } = fixture(options);

    await expect(service.approveAndSend(pending.id)).rejects.toThrow(
      "Reply dispatch is unavailable",
    );
    expect(outbox.findById(pending.id)).toMatchObject({
      status: "approval_pending",
      approvedAt: null,
      attempts: 0,
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invalid SMTP settings",
      { settingsValue: { host: "", port: 0, secure: false } },
    ],
    [
      "invalid credential",
      {
        credential: {
          version: 1 as const,
          kind: "imap_password" as const,
          username: "",
          password: "",
        },
      },
    ],
  ])("fails closed for %s before approval", async (_name, options) => {
    const transportFactory = { create: vi.fn(() => ({ send: vi.fn() })) };
    const { outbox, pending, service, transport } = fixture({
      ...options,
      transportFactory,
    });

    await expect(service.approveAndSend(pending.id)).rejects.toThrow(
      "Reply dispatch is unavailable",
    );
    expect(outbox.findById(pending.id)).toMatchObject({
      status: "approval_pending",
      approvedAt: null,
      attempts: 0,
    });
    expect(transportFactory.create).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("fails closed when transport construction fails before approval", async () => {
    const transportFactory = {
      create: vi.fn(() => {
        throw new Error("SMTP construction failed");
      }),
    };
    const { outbox, pending, service, transport } = fixture({
      transportFactory,
    });

    await expect(service.approveAndSend(pending.id)).rejects.toThrow(
      "Reply dispatch is unavailable",
    );
    expect(outbox.findById(pending.id)).toMatchObject({
      status: "approval_pending",
      approvedAt: null,
      attempts: 0,
    });
    expect(transportFactory.create).toHaveBeenCalledOnce();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("fails closed for malformed outbox actions before approval", async () => {
    const { outbox, pending, service, transport } = fixture();
    const malformed = outbox.createDraft({
      connectorAccountId: pending.connectorAccountId,
      kind: "email.reply",
      payload: { body: "missing exact payload" },
      idempotencyKey: randomUUID(),
      requiresApproval: true,
      safeRetry: false,
    });
    outbox.requestApproval(malformed.id);

    await expect(service.approveAndSend(malformed.id)).rejects.toThrow(
      "Reply dispatch is unavailable",
    );
    expect(outbox.findById(malformed.id)).toMatchObject({
      status: "approval_pending",
      approvedAt: null,
      attempts: 0,
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("fails closed for a non-reply outbox kind before approval", async () => {
    const { outbox, pending, service, transport } = fixture();
    const malformed = outbox.createDraft({
      connectorAccountId: pending.connectorAccountId,
      kind: "email.send",
      payload: {
        threadId: randomUUID(),
        externalThreadId: "thread-1",
        inReplyTo: "<incoming@example.com>",
        to: ["client@example.com"],
        subject: "Re: Proposal",
        body: "Thanks",
      },
      idempotencyKey: randomUUID(),
      requiresApproval: true,
      safeRetry: false,
    });
    outbox.requestApproval(malformed.id);

    await expect(service.approveAndSend(malformed.id)).rejects.toThrow(
      "Reply dispatch is unavailable",
    );
    expect(outbox.findById(malformed.id)).toMatchObject({
      status: "approval_pending",
      approvedAt: null,
      attempts: 0,
    });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("claims concurrent duplicate approvals once", async () => {
    const { pending, service, transport } = fixture();

    await Promise.all([
      service.approveAndSend(pending.id),
      service.approveAndSend(pending.id),
    ]);

    expect(transport.send).toHaveBeenCalledOnce();
  });

  it.each(["confirmed", "uncertain", "dispatching"])(
    "replays %s records without sending",
    async (status) => {
      const { outbox, pending, service, transport } = fixture();
      if (status === "dispatching") {
        outbox.approve(pending.id);
        outbox.claimDispatch(pending.id);
      } else {
        outbox.approve(pending.id);
        outbox.claimDispatch(pending.id);
        if (status === "confirmed") outbox.confirm(pending.id, null);
        else outbox.markUncertain(pending.id, "already uncertain");
      }

      await expect(service.approveAndSend(pending.id)).resolves.toMatchObject({
        status,
        attempts: 1,
      });
      expect(transport.send).not.toHaveBeenCalled();
    },
  );

  it("settles a transport exception as uncertain without exposing transport details", async () => {
    const transport: SmtpReplyTransport = {
      send: vi.fn(async () => {
        throw new Error("SMTP password=super-secret rejected");
      }),
    };
    const { outbox, pending, service } = fixture({ transport });

    await expect(service.approveAndSend(pending.id)).resolves.toEqual({
      id: pending.id,
      status: "uncertain",
      attempts: 1,
      approvedAt: expect.any(String),
      lastError: "Email dispatch outcome is uncertain.",
    });
    expect(outbox.findById(pending.id)?.lastError).toBe(
      "Email dispatch outcome is uncertain.",
    );
  });

  it("persists only a minimal receipt after send", async () => {
    const transport = {
      send: vi.fn(async () => ({
        messageId: "<sent@example.com>",
        acceptedCount: 1,
        rejectedCount: 0,
        providerToken: "secret",
      })),
    } as SmtpReplyTransport;
    const { outbox, pending, service } = fixture({ transport });

    await expect(service.approveAndSend(pending.id)).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(outbox.findById(pending.id)?.providerReceipt).toEqual({
      messageId: "<sent@example.com>",
      acceptedCount: 1,
      rejectedCount: 0,
    });
  });

  it("settles invalid post-send receipts as uncertain", async () => {
    const transport = {
      send: vi.fn(async () => ({
        messageId: "<sent@example.com>",
        acceptedCount: -1,
        rejectedCount: 0,
      })),
    } as SmtpReplyTransport;
    const { outbox, pending, service } = fixture({ transport });

    await expect(service.approveAndSend(pending.id)).resolves.toMatchObject({
      status: "uncertain",
      lastError: "Email dispatch outcome is uncertain.",
    });
    expect(outbox.findById(pending.id)?.providerReceipt).toBeNull();
  });
});
