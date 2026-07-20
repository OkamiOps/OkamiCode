import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ConnectorAccount } from "./service";
import type { ConnectorCredential } from "../connectors/credential-vault";
import {
  ImapSyncAdapter,
  ImapSyncError,
  type ImapClient,
  type ImapClientFactory,
} from "./imap-adapter";

const account: ConnectorAccount = {
  id: "account-1",
  provider: "imap",
  displayName: "Work",
  address: "me@example.com",
  status: "connected",
  syncCursor: null,
  lastError: null,
  lastSyncedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function message(uid: number, flags: Set<string> = new Set(["\\Seen"])) {
  return {
    uid,
    flags,
    envelope: {
      subject: "Envelope subject",
      from: [{ address: "other@example.com" }],
      to: [{ address: "me@example.com" }],
    },
    bodyStructure: {},
    internalDate: new Date("2026-07-01T10:00:00.000Z"),
    size: 123,
    threadId: "provider-thread",
    labels: new Set(["Inbox"]),
  };
}

function rfc822({
  messageId = "<message-1@example.com>",
  subject = "A subject",
  from = "Other <other@example.com>",
  to = "Me <me@example.com>",
  body = "Hello   world\n\nwith detail",
}: Partial<{
  messageId: string;
  subject: string;
  from: string;
  to: string;
  body: string;
}> = {}) {
  return Buffer.from(
    `Message-ID: ${messageId}\r\nSubject: ${subject}\r\nFrom: ${from}\r\nTo: ${to}\r\nDate: Tue, 01 Jul 2026 09:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  );
}

function rfc822WithAttachment() {
  return Buffer.from(
    [
      "Message-ID: <attachment@example.com>",
      "From: Other <other@example.com>",
      "To: Me <me@example.com>",
      "Content-Type: multipart/mixed; boundary=boundary",
      "",
      "--boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Body",
      "--boundary",
      "Content-Type: application/pdf",
      'Content-Disposition: attachment; filename="report.pdf"',
      "Content-ID: <report-id>",
      "Content-Transfer-Encoding: base64",
      "",
      "cGRmLWJ5dGVz",
      "--boundary--",
    ].join("\r\n"),
  );
}

function fakeClient(overrides: Partial<ImapClient> = {}) {
  const lock = { release: vi.fn() };
  const client: ImapClient = {
    mailbox: { uidValidity: 99n, uidNext: 5, exists: 4 },
    connect: vi.fn(),
    logout: vi.fn(),
    getMailboxLock: vi.fn().mockResolvedValue(lock),
    fetchAll: vi.fn().mockResolvedValue([message(4), message(3)]),
    download: vi.fn().mockResolvedValue({ content: Readable.from([rfc822()]) }),
    ...overrides,
  };
  return { client, lock };
}

function adapter(
  client: ImapClient,
  credential: ConnectorCredential = {
    version: 1,
    kind: "imap_password",
    username: "me@example.com",
    password: "super-secret",
  },
) {
  const factory: ImapClientFactory = vi.fn().mockReturnValue(client);
  return {
    factory,
    adapter: new ImapSyncAdapter(
      { get: vi.fn().mockResolvedValue(credential) },
      factory,
      () => new Date("2026-07-02T12:00:00.000Z"),
    ),
  };
}

describe("ImapSyncAdapter", () => {
  it("validates configuration and uses bounded defaults", async () => {
    const { client } = fakeClient();
    const { adapter: subject } = adapter(client);
    await expect(
      subject.sync({
        account,
        configuration: { host: "" as string, port: 993, secure: true },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
    await expect(
      subject.sync({
        account,
        configuration: { host: "mail.example.com", port: 0, secure: true },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
    await expect(
      subject.sync({
        account,
        configuration: {
          host: "mail.example.com",
          port: 993,
          secure: true,
          maxInitialMessages: 501,
        },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
    await expect(
      subject.sync({
        account,
        configuration: {
          host: "mail.example.com",
          port: 993,
          secure: true,
          maxMessageBytes: 10 * 1024 * 1024 + 1,
        },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
    await subject.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX", {
      readOnly: true,
    });
    expect(client.fetchAll).toHaveBeenCalledWith("1:*", expect.any(Object), {
      uid: true,
    });
  });

  it("maps password and OAuth credentials without exposing secrets", async () => {
    const { client } = fakeClient({
      mailbox: { uidValidity: 1, uidNext: 1, exists: 0 },
    });
    const password = adapter(client);
    await password.adapter.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(password.factory).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: "me@example.com", pass: "super-secret" },
      }),
    );
    const oauth = adapter(client, {
      version: 1,
      kind: "oauth",
      username: "me@example.com",
      accessToken: "top-token",
    });
    await oauth.adapter.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(oauth.factory).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: "me@example.com", accessToken: "top-token" },
      }),
    );
    const failing = adapter(client, {
      version: 1,
      kind: "imap_password",
      username: "user@example.com",
      password: "leaked-secret",
    });
    client.connect = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "mail.example.com user@example.com leaked-secret server failure",
        ),
      );
    await expect(
      failing.adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.toThrow(ImapSyncError);
    await expect(
      failing.adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.not.toThrow(
      /mail\.example|user@example|leaked-secret|server failure/,
    );
  });

  it("syncs an initial limited window, fetches metadata before downloads, and normalizes output", async () => {
    const { client, lock } = fakeClient({
      mailbox: { uidValidity: 99n, uidNext: 205, exists: 204 },
      fetchAll: vi
        .fn()
        .mockResolvedValue([
          message(204, new Set(["\\Flagged"])),
          message(203),
        ]),
      download: vi.fn().mockImplementation(async (uid: string) => ({
        content: Readable.from([
          uid === "203"
            ? rfc822({
                messageId: "<message-2@example.com>",
                from: "Me <me@example.com>",
              })
            : rfc822(),
        ]),
      })),
    });
    const { adapter: subject } = adapter(client);
    const result = await subject.sync({
      account,
      configuration: {
        host: "mail.example.com",
        port: 993,
        secure: true,
        maxInitialMessages: 100,
      },
    });
    expect(client.fetchAll).toHaveBeenCalledWith(
      "105:*",
      expect.objectContaining({
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        size: true,
        threadId: true,
        labels: true,
      }),
      { uid: true },
    );
    expect(vi.mocked(client.fetchAll).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.download).mock.invocationCallOrder[0],
    );
    expect(client.download).toHaveBeenCalledWith("203", undefined, {
      uid: true,
      maxBytes: 2 * 1024 * 1024,
    });
    expect(result).toMatchObject({
      previousCursor: null,
      nextCursor: JSON.stringify({
        version: 1,
        uidValidity: "99",
        lastUid: 204,
      }),
      syncedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "<message-2@example.com>",
      direction: "outgoing",
      bodyFormat: "text",
      sender: "me@example.com",
    });
    expect(result.threads[0]).toMatchObject({
      externalThreadId: "provider-thread",
      subject: "A subject",
      snippet: "Hello world with detail",
      unreadCount: 1,
      labels: expect.arrayContaining(["Inbox", "\\Flagged"]),
    });
    expect(lock.release).toHaveBeenCalledOnce();
    expect(client.logout).toHaveBeenCalledOnce();
  });

  it("handles incremental no-op, UID validity reset, empty mailbox and invalid cursor", async () => {
    const cursor = JSON.stringify({
      version: 1,
      uidValidity: "99",
      lastUid: 4,
    });
    const noOp = fakeClient({
      mailbox: { uidValidity: 99, uidNext: 5, exists: 4 },
    });
    const noOpResult = await adapter(noOp.client).adapter.sync({
      account: { ...account, syncCursor: cursor },
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(noOpResult.messages).toEqual([]);
    expect(noOp.client.fetchAll).not.toHaveBeenCalled();
    const reset = fakeClient({
      mailbox: { uidValidity: 100, uidNext: 5, exists: 4 },
    });
    await adapter(reset.client).adapter.sync({
      account: { ...account, syncCursor: cursor },
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(reset.client.fetchAll).toHaveBeenCalledWith(
      "1:*",
      expect.any(Object),
      { uid: true },
    );
    const empty = fakeClient({
      mailbox: { uidValidity: 3, uidNext: 1, exists: 0 },
    });
    const emptyResult = await adapter(empty.client).adapter.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(emptyResult.nextCursor).toBe(
      JSON.stringify({ version: 1, uidValidity: "3", lastUid: 0 }),
    );
    expect(empty.client.fetchAll).not.toHaveBeenCalled();
    await expect(
      adapter(noOp.client).adapter.sync({
        account: { ...account, syncCursor: "not-json" },
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
  });

  it("returns attachment metadata only, never the parsed binary content", async () => {
    const { client } = fakeClient({
      download: vi.fn().mockResolvedValue({
        content: Readable.from([rfc822WithAttachment()]),
      }),
    });
    const result = await adapter(client).adapter.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(result.messages[0].attachments).toEqual([
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        size: 9,
        contentId: "<report-id>",
        disposition: "attachment",
      },
    ]);
    expect(result.messages[0].attachments[0]).not.toHaveProperty("content");
  });

  it("bounds downloaded stream bytes and always releases resources after failures", async () => {
    const { client, lock } = fakeClient({
      download: vi.fn().mockResolvedValue({
        content: Readable.from([Buffer.alloc(8), Buffer.alloc(8)]),
      }),
    });
    await expect(
      adapter(client).adapter.sync({
        account,
        configuration: {
          host: "mail.example.com",
          port: 993,
          secure: true,
          maxMessageBytes: 10,
        },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
    expect(lock.release).toHaveBeenCalledOnce();
    expect(client.logout).toHaveBeenCalledOnce();
    expect(client.download).toHaveBeenCalledWith("3", undefined, {
      uid: true,
      maxBytes: 10,
    });
  });
});
