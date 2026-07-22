import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ConnectorAccount } from "./service";
import type { ConnectorCredential } from "../connectors/credential-vault";
import { GoogleOAuthRefreshRequiredError } from "../connectors/google-oauth";
import {
  ImapSyncAdapter,
  ImapSyncError,
  createProductionImapClient,
  type ImapClient,
  type ImapClientConstructor,
  type ImapClientFactory,
  type ImapClientOptions,
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

function rfc822WithHtmlAlternative() {
  return Buffer.from(
    [
      "Message-ID: <html-message@example.com>",
      "Subject: HTML message",
      "From: Other <other@example.com>",
      "To: Me <me@example.com>",
      "Content-Type: multipart/alternative; boundary=alternative",
      "",
      "--alternative",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Plain fallback",
      "--alternative",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<html><body><h1 style="color: #f97316">Formatted email</h1></body></html>',
      "--alternative--",
    ].join("\r\n"),
  );
}

function rfc822WithCalendarInvitation() {
  const invitation = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:invite-1\r\nSUMMARY:Reunião com cliente\r\nDTSTART:20260722T090000Z\r\nDTEND:20260722T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  return Buffer.from(
    [
      "Message-ID: <calendar-invite@example.com>",
      "From: Client <client@example.com>",
      "To: Me <me@example.com>",
      "Content-Type: multipart/mixed; boundary=calendar-boundary",
      "",
      "--calendar-boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Meeting invitation",
      "--calendar-boundary",
      'Content-Type: text/calendar; method=REQUEST; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      "",
      invitation,
      "--calendar-boundary--",
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
    list: vi.fn().mockResolvedValue([
      { path: "Trash", specialUse: "\\Trash" },
      { path: "Junk", specialUse: "\\Junk" },
    ]),
    search: vi.fn().mockResolvedValue([4]),
    messageMove: vi.fn().mockResolvedValue({ destination: "Trash" }),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
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
  it("imports recent messages from provider spam and trash folders", async () => {
    const { client } = fakeClient();
    vi.mocked(client.getMailboxLock).mockImplementation(async (mailbox) => {
      client.mailbox =
        mailbox === "Junk"
          ? { uidValidity: 201, uidNext: 3, exists: 2 }
          : { uidValidity: 202, uidNext: 2, exists: 1 };
      return { release: vi.fn() };
    });
    vi.mocked(client.fetchAll).mockImplementation(async () => [message(1)]);
    vi.mocked(client.download)
      .mockResolvedValueOnce({
        content: Readable.from([
          rfc822({ messageId: "<trash@example.com>", subject: "Trashed" }),
        ]),
      })
      .mockResolvedValueOnce({
        content: Readable.from([
          rfc822({ messageId: "<spam@example.com>", subject: "Spam" }),
        ]),
      });

    const result = await adapter(client).adapter.syncSpecialFolders({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });

    expect(result.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: "Trashed", folder: "trash" }),
        expect.objectContaining({ subject: "Spam", folder: "spam" }),
      ]),
    );
    expect(result.messages.map((item) => item.providerUid)).toEqual([
      "imap-trash:202:1",
      "imap-spam:201:1",
    ]);
  });

  it("reconciles flags and remotely deleted UIDs even when there are no new messages", async () => {
    const fetchAll = vi
      .fn()
      .mockResolvedValue([message(5, new Set(["\\Seen"]))]);
    const download = vi.fn();
    const { client } = fakeClient({
      mailbox: { uidValidity: 99n, uidNext: 6, exists: 1 },
      fetchAll,
      download,
    });

    const result = await adapter(client).adapter.sync({
      account: {
        ...account,
        syncCursor: JSON.stringify({
          version: 3,
          uidValidity: "99",
          lastUid: 5,
        }),
      },
      configuration: { host: "mail.example.com", port: 993, secure: true },
      knownProviderUids: ["imap:99:4", "imap:99:5"],
    } as never);

    expect(fetchAll).toHaveBeenCalledWith(
      [4, 5],
      { uid: true, flags: true },
      { uid: true },
    );
    expect(download).not.toHaveBeenCalled();
    expect(
      (
        result as typeof result & {
          reconciliation: {
            checkedProviderUids: string[];
            states: Array<{ providerUid: string; seen: boolean }>;
          };
        }
      ).reconciliation,
    ).toEqual({
      checkedProviderUids: ["imap:99:4", "imap:99:5"],
      states: [{ providerUid: "imap:99:5", seen: true }],
    });
  });

  it("removes the Seen flag from every provider message in the thread", async () => {
    const messageFlagsRemove = vi.fn().mockResolvedValue(true);
    const { client } = fakeClient({ messageFlagsRemove } as never);

    await adapter(client).adapter.setMessagesSeen({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
      externalMessageIds: ["imap:99:27", "<two@example.com>"],
      seen: false,
    });

    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX", {
      readOnly: false,
    });
    expect(messageFlagsRemove).toHaveBeenCalledWith([4, 27], ["\\Seen"], {
      uid: true,
    });
  });

  it("moves provider messages to the discovered special-use mailbox", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([14])
      .mockResolvedValueOnce([9]);
    const messageMove = vi.fn().mockResolvedValue({ destination: "Spam" });
    const { client } = fakeClient({
      list: vi.fn().mockResolvedValue([
        { path: "Deleted", specialUse: "\\Trash" },
        { path: "Spam", specialUse: "\\Junk" },
      ]),
      search,
      messageMove,
    });

    await adapter(client).adapter.moveMessages({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
      externalMessageIds: ["<one@example.com>", "<two@example.com>"],
      destination: "spam",
    });

    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX", {
      readOnly: false,
    });
    expect(search).toHaveBeenNthCalledWith(
      1,
      { header: { "message-id": "<one@example.com>" } },
      { uid: true },
    );
    expect(messageMove).toHaveBeenCalledWith([9, 14], "Spam", { uid: true });
  });

  it("uses the stored fallback UID without searching message headers", async () => {
    const search = vi.fn();
    const messageMove = vi.fn().mockResolvedValue({ destination: "Trash" });
    const { client } = fakeClient({ search, messageMove });

    await adapter(client).adapter.moveMessages({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
      externalMessageIds: ["imap:99:27"],
      destination: "trash",
    });

    expect(search).not.toHaveBeenCalled();
    expect(messageMove).toHaveBeenCalledWith([27], "Trash", { uid: true });
  });

  it("treats a message that already left the source mailbox as moved", async () => {
    const messageMove = vi.fn();
    const { client } = fakeClient({
      search: vi.fn().mockResolvedValue([]),
      messageMove,
    });

    await expect(
      adapter(client).adapter.moveMessages({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
        externalMessageIds: ["<already-moved@example.com>"],
        destination: "trash",
      }),
    ).resolves.toBeUndefined();
    expect(messageMove).not.toHaveBeenCalled();
  });

  it("keeps a completed move successful when logout cleanup fails", async () => {
    const messageMove = vi.fn().mockResolvedValue({ destination: "Trash" });
    const { client } = fakeClient({
      messageMove,
      logout: vi.fn().mockRejectedValue(new Error("socket already closed")),
    });

    await expect(
      adapter(client).adapter.moveMessages({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
        externalMessageIds: ["imap:99:27"],
        destination: "trash",
      }),
    ).resolves.toBeUndefined();
    expect(messageMove).toHaveBeenCalledWith([27], "Trash", { uid: true });
  });

  it("marks an expired Google refresh grant as auth_required before opening IMAP", async () => {
    const { client } = fakeClient();
    const factory: ImapClientFactory = vi.fn().mockReturnValue(client);
    const syncer = new ImapSyncAdapter(
      {
        get: vi.fn().mockRejectedValue(new GoogleOAuthRefreshRequiredError()),
      },
      factory,
    );

    await expect(
      syncer.sync({
        account: { ...account, provider: "gmail" },
        configuration: { host: "imap.gmail.com", port: 993, secure: true },
      }),
    ).rejects.toMatchObject({
      code: "auth_required",
      message:
        "A autorização do Google expirou. Reconecte a conta para continuar.",
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it("classifies Gmail's app-password requirement without exposing the raw server response", async () => {
    const gmailAccount: ConnectorAccount = {
      ...account,
      provider: "gmail",
      address: "marcos@gmail.com",
    };
    const gmailFailure = Object.assign(new Error("Command failed"), {
      code: "ALERT",
      response:
        "3 NO [ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)",
    });
    const { client } = fakeClient({
      connect: vi.fn().mockRejectedValue(gmailFailure),
    });

    await expect(
      adapter(client).adapter.sync({
        account: gmailAccount,
        configuration: {
          host: "imap.gmail.com",
          port: 993,
          secure: true,
        },
      }),
    ).rejects.toMatchObject({
      name: "ImapSyncError",
      code: "auth_required",
      message:
        "O Gmail recusou a conexão antiga. Reconecte a conta usando Entrar com Google.",
    });
  });

  it("creates the production client with logging disabled", () => {
    const constructed = vi.fn();
    class FakeImapFlow {
      constructor(options: ImapClientOptions) {
        constructed(options);
        return fakeClient().client;
      }
    }
    const options: ImapClientOptions = {
      host: "mail.example.com",
      port: 993,
      secure: true,
      auth: { user: "me@example.com", pass: "secret" },
    };
    createProductionImapClient(options, FakeImapFlow as ImapClientConstructor);
    expect(constructed).toHaveBeenCalledWith({
      ...options,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      logger: false,
    });
  });

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
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    const oauthFailure = adapter(client, {
      version: 1,
      kind: "oauth",
      username: "user@example.com",
      accessToken: "leaked-access-token",
    });
    await expect(
      oauthFailure.adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.not.toThrow(/leaked-access-token/);
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(
      /leaked-secret|leaked-access-token/,
    );
    warning.mockRestore();
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
        version: 3,
        uidValidity: "99",
        lastUid: 204,
      }),
      syncedAt: "2026-07-02T12:00:00.000Z",
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      externalMessageId: "<message-2@example.com>",
      providerUid: "imap:99:203",
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

  it("preserves the HTML alternative instead of flattening a multipart email", async () => {
    const { client } = fakeClient({
      mailbox: { uidValidity: 99n, uidNext: 2, exists: 1 },
      fetchAll: vi.fn().mockResolvedValue([message(1)]),
      download: vi.fn().mockResolvedValue({
        content: Readable.from([rfc822WithHtmlAlternative()]),
      }),
    });
    const { adapter: subject } = adapter(client);

    const result = await subject.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });

    expect(result.messages[0]).toMatchObject({
      bodyFormat: "html",
      body: expect.stringContaining("Formatted email"),
    });
    expect(result.threads[0]?.snippet).toContain("Plain fallback");
  });

  it("provides a stable preview when a valid email has an empty body", async () => {
    const { client } = fakeClient({
      mailbox: { uidValidity: 99n, uidNext: 2, exists: 1 },
      fetchAll: vi.fn().mockResolvedValue([message(1)]),
      download: vi.fn().mockResolvedValue({
        content: Readable.from([rfc822({ body: "" })]),
      }),
    });

    const result = await adapter(client).adapter.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });

    expect(result.messages[0]?.body).toBe("");
    expect(result.threads[0]?.snippet).toBe("Sem prévia disponível");
  });

  it("handles incremental no-op, UID validity reset, empty mailbox and invalid cursor", async () => {
    const cursor = JSON.stringify({
      version: 3,
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
    const incremental = fakeClient({
      mailbox: { uidValidity: 99, uidNext: 7, exists: 6 },
      fetchAll: vi.fn().mockResolvedValue([message(5), message(6)]),
    });
    await adapter(incremental.client).adapter.sync({
      account: { ...account, syncCursor: cursor },
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });
    expect(incremental.client.fetchAll).toHaveBeenCalledWith(
      "5:*",
      expect.any(Object),
      { uid: true },
    );
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
      JSON.stringify({ version: 3, uidValidity: "3", lastUid: 0 }),
    );
    expect(empty.client.fetchAll).not.toHaveBeenCalled();
    await expect(
      adapter(noOp.client).adapter.sync({
        account: { ...account, syncCursor: "not-json" },
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
  });

  it("rehydrates the recent window once for a cursor before calendar extraction", async () => {
    const legacy = fakeClient({
      mailbox: { uidValidity: 99, uidNext: 5, exists: 4 },
      fetchAll: vi.fn().mockResolvedValue([message(4)]),
    });

    const result = await adapter(legacy.client).adapter.sync({
      account: {
        ...account,
        syncCursor: JSON.stringify({
          version: 2,
          uidValidity: "99",
          lastUid: 4,
        }),
      },
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });

    expect(legacy.client.fetchAll).toHaveBeenCalledWith(
      "1:*",
      expect.any(Object),
      { uid: true },
    );
    expect(JSON.parse(result.nextCursor ?? "{}")).toMatchObject({
      version: 3,
      lastUid: 4,
    });
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

  it("extracts bounded calendar invitations for the unified Agenda", async () => {
    const { client } = fakeClient({
      fetchAll: vi.fn().mockResolvedValue([message(3)]),
      download: vi.fn().mockResolvedValue({
        content: Readable.from([rfc822WithCalendarInvitation()]),
      }),
    });
    const result = await adapter(client).adapter.sync({
      account,
      configuration: { host: "mail.example.com", port: 993, secure: true },
    });

    expect(result.calendarInvitations).toEqual([
      {
        externalMessageId: "<calendar-invite@example.com>",
        payload: expect.stringContaining("UID:invite-1"),
      },
    ]);
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

  it("sanitizes release and logout failures after an otherwise successful sync", async () => {
    const releaseFailure = fakeClient();
    releaseFailure.lock.release.mockImplementation(() => {
      throw new Error("release leaked-secret from mail.example.com");
    });
    await expect(
      adapter(releaseFailure.client).adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.toThrow("IMAP synchronization failed");
    expect(releaseFailure.client.logout).toHaveBeenCalledOnce();

    const logoutFailure = fakeClient({
      logout: vi.fn().mockRejectedValue(new Error("logout leaked-secret")),
    });
    await expect(
      adapter(logoutFailure.client).adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.toThrow("IMAP synchronization failed");
  });

  it("preserves a sanitized primary error while attempting failing cleanup", async () => {
    const { client, lock } = fakeClient({
      download: vi
        .fn()
        .mockRejectedValue(new Error("primary leaked-secret server detail")),
      logout: vi.fn().mockRejectedValue(new Error("logout leaked-secret")),
    });
    lock.release.mockImplementation(() => {
      throw new Error("release leaked-secret");
    });
    await expect(
      adapter(client).adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.toThrow("IMAP synchronization failed");
    await expect(
      adapter(client).adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.not.toThrow(/primary|release|logout|leaked-secret/);
    expect(lock.release).toHaveBeenCalledTimes(2);
    expect(client.logout).toHaveBeenCalledTimes(2);
  });

  it("fails closed when neither parsed nor envelope data identifies a sender", async () => {
    const { client } = fakeClient({
      fetchAll: vi
        .fn()
        .mockResolvedValue([
          { ...message(3), envelope: { subject: "No sender" } },
        ]),
      download: vi.fn().mockResolvedValue({
        content: Readable.from([rfc822({ from: "" })]),
      }),
    });
    await expect(
      adapter(client).adapter.sync({
        account,
        configuration: { host: "mail.example.com", port: 993, secure: true },
      }),
    ).rejects.toBeInstanceOf(ImapSyncError);
  });
});
