import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { ConnectorCredential } from "../connectors/credential-vault";
import { GoogleOAuthRefreshRequiredError } from "../connectors/google-oauth";
import type {
  ApplyInboxSyncBatch,
  ConnectorAccount,
  InboxAttachment,
  SyncMessage,
  SyncThread,
} from "./service";

const DEFAULT_INITIAL_MESSAGES = 100;
const MAX_INITIAL_MESSAGES = 500;
const DEFAULT_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const MAX_CALENDAR_INVITATION_BYTES = 512 * 1024;
const IMAP_CONNECTION_TIMEOUT_MS = 15_000;
const IMAP_GREETING_TIMEOUT_MS = 10_000;
const IMAP_SOCKET_TIMEOUT_MS = 30_000;

export interface ImapAccountConfiguration {
  host: string;
  port: number;
  secure: boolean;
  mailbox?: string;
  maxInitialMessages?: number;
  maxMessageBytes?: number;
}

export interface ImapSyncInput {
  account: ConnectorAccount;
  configuration: ImapAccountConfiguration;
}

export interface ImapMailboxState {
  uidValidity: bigint | number | string;
  uidNext: number;
  exists: number;
}

export interface ImapFetchedMessage {
  uid: number;
  flags?: Set<string>;
  envelope?: {
    subject?: string;
    from?: Array<{ address?: string | null }>;
    to?: Array<{ address?: string | null }>;
  };
  bodyStructure?: unknown;
  internalDate?: Date | string;
  size?: number;
  threadId?: string;
  labels?: Set<string>;
}

export interface ImapClient {
  mailbox: ImapMailboxState | undefined;
  connect(): Promise<unknown>;
  logout(): Promise<unknown>;
  getMailboxLock(
    mailbox: string,
    options: { readOnly: boolean },
  ): Promise<{ release(): void }>;
  list(): Promise<Array<{ path: string; specialUse?: string }>>;
  search(
    query: { header: Record<string, string> },
    options: { uid: true },
  ): Promise<number[] | false>;
  messageMove(
    range: number[],
    destination: string,
    options: { uid: true },
  ): Promise<unknown | false>;
  messageFlagsAdd(
    range: number[],
    flags: string[],
    options: { uid: true },
  ): Promise<unknown | false>;
  messageFlagsRemove(
    range: number[],
    flags: string[],
    options: { uid: true },
  ): Promise<unknown | false>;
  fetchAll(
    range: string,
    query: Record<string, boolean>,
    options: { uid: true },
  ): Promise<ImapFetchedMessage[]>;
  download(
    uid: string,
    part: undefined,
    options: { uid: true; maxBytes: number },
  ): Promise<{ content: AsyncIterable<Buffer | Uint8Array | string> }>;
}

export type ImapClientOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass?: string; accessToken?: string };
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  logger?: false;
};

export type ImapClientFactory = (options: ImapClientOptions) => ImapClient;
export type ImapClientConstructor = new (
  options: ImapClientOptions & { logger: false },
) => ImapClient;

export interface CredentialReader {
  get(accountId: string): Promise<ConnectorCredential | null>;
}

export type InboxThreadDestination = "spam" | "trash";

export interface ImapMoveMessagesInput extends ImapSyncInput {
  externalMessageIds: string[];
  destination: InboxThreadDestination;
}

export interface ImapSetMessagesSeenInput extends ImapSyncInput {
  externalMessageIds: string[];
  seen: boolean;
}

export class ImapSyncError extends Error {
  constructor(
    message = "IMAP synchronization failed",
    readonly code: "auth_required" | "sync_failed" = "sync_failed",
  ) {
    super(message);
    this.name = "ImapSyncError";
  }
}

export class ImapSyncAdapter {
  constructor(
    private readonly vault: CredentialReader,
    private readonly clientFactory: ImapClientFactory = productionClientFactory,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async sync(input: ImapSyncInput): Promise<ApplyInboxSyncBatch> {
    let configuration: ValidatedConfiguration;
    try {
      configuration = validateConfiguration(input.configuration);
    } catch {
      throw new ImapSyncError("Invalid IMAP configuration");
    }

    let cursor: Cursor | null;
    try {
      cursor = parseCursor(input.account.syncCursor);
    } catch {
      throw new ImapSyncError("Invalid IMAP sync cursor");
    }

    const client = await this.createClient(input, configuration);

    let lock: { release(): void } | undefined;
    let primaryError: ImapSyncError | null = null;
    let stage: "connect" | "mailbox" | "messages" = "connect";
    let result: ApplyInboxSyncBatch | undefined;
    try {
      await client.connect();
      stage = "mailbox";
      lock = await client.getMailboxLock(configuration.mailbox, {
        readOnly: true,
      });
      stage = "messages";
      result = await this.readBatch(input, configuration, cursor, client);
    } catch (cause) {
      primaryError = classifyImapFailure(cause, input.account.provider);
      const error = safeImapError(cause);
      console.warn("[okami] IMAP synchronization failed", {
        accountId: input.account.id,
        provider: input.account.provider,
        host: configuration.host,
        stage,
        errorName: error.errorName,
        errorCode: error.errorCode,
      });
    }

    let cleanupFailed = false;
    try {
      lock?.release();
    } catch {
      cleanupFailed = true;
    }
    try {
      await client.logout();
    } catch {
      cleanupFailed = true;
    }
    if (primaryError) throw primaryError;
    if (cleanupFailed || !result) throw new ImapSyncError();
    return result;
  }

  async moveMessages(input: ImapMoveMessagesInput): Promise<void> {
    let configuration: ValidatedConfiguration;
    try {
      configuration = validateConfiguration(input.configuration);
    } catch {
      throw new ImapSyncError("Invalid IMAP configuration");
    }
    if (input.externalMessageIds.length === 0) {
      throw new ImapSyncError("No messages available to move");
    }

    const client = await this.createClient(input, configuration);
    let lock: { release(): void } | undefined;
    let primaryError: ImapSyncError | null = null;
    try {
      await client.connect();
      const mailboxes = await client.list();
      const destination = resolveDestinationMailbox(
        mailboxes,
        input.destination,
        input.account.provider,
      );
      lock = await client.getMailboxLock(configuration.mailbox, {
        readOnly: false,
      });
      const uids = await resolveMessageUids(client, input.externalMessageIds);
      if (uids.length === 0) {
        throw new ImapSyncError("Messages are no longer available");
      }
      const moved = await client.messageMove(uids, destination, { uid: true });
      if (moved === false) throw new ImapSyncError("Message move failed");
    } catch (cause) {
      primaryError =
        cause instanceof ImapSyncError
          ? cause
          : classifyImapFailure(cause, input.account.provider);
      const error = safeImapError(cause);
      console.warn("[okami] IMAP message move failed", {
        accountId: input.account.id,
        provider: input.account.provider,
        destination: input.destination,
        errorName: error.errorName,
        errorCode: error.errorCode,
      });
    }

    let cleanupFailed = false;
    try {
      lock?.release();
    } catch {
      cleanupFailed = true;
    }
    try {
      await client.logout();
    } catch {
      cleanupFailed = true;
    }
    if (primaryError) throw primaryError;
    if (cleanupFailed) throw new ImapSyncError();
  }

  async setMessagesSeen(input: ImapSetMessagesSeenInput): Promise<void> {
    let configuration: ValidatedConfiguration;
    try {
      configuration = validateConfiguration(input.configuration);
    } catch {
      throw new ImapSyncError("Invalid IMAP configuration");
    }
    if (input.externalMessageIds.length === 0) {
      throw new ImapSyncError("No messages available to update");
    }

    const client = await this.createClient(input, configuration);
    let lock: { release(): void } | undefined;
    let primaryError: ImapSyncError | null = null;
    try {
      await client.connect();
      lock = await client.getMailboxLock(configuration.mailbox, {
        readOnly: false,
      });
      const uids = await resolveMessageUids(client, input.externalMessageIds);
      if (uids.length === 0) {
        throw new ImapSyncError("Messages are no longer available");
      }
      const updated = input.seen
        ? await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true })
        : await client.messageFlagsRemove(uids, ["\\Seen"], { uid: true });
      if (updated === false) throw new ImapSyncError("Message update failed");
    } catch (cause) {
      primaryError =
        cause instanceof ImapSyncError
          ? cause
          : classifyImapFailure(cause, input.account.provider);
      const error = safeImapError(cause);
      console.warn("[okami] IMAP read state update failed", {
        accountId: input.account.id,
        provider: input.account.provider,
        errorName: error.errorName,
        errorCode: error.errorCode,
      });
    }

    let cleanupFailed = false;
    try {
      lock?.release();
    } catch {
      cleanupFailed = true;
    }
    try {
      await client.logout();
    } catch {
      cleanupFailed = true;
    }
    if (primaryError) throw primaryError;
    if (cleanupFailed) throw new ImapSyncError();
  }

  private async createClient(
    input: ImapSyncInput,
    configuration: ValidatedConfiguration,
  ): Promise<ImapClient> {
    let credential: ConnectorCredential | null;
    try {
      credential = await this.vault.get(input.account.id);
    } catch (cause) {
      if (cause instanceof GoogleOAuthRefreshRequiredError) {
        throw new ImapSyncError(cause.message, "auth_required");
      }
      throw new ImapSyncError("IMAP credentials unavailable");
    }
    if (!validCredential(credential)) {
      throw new ImapSyncError("IMAP credentials unavailable");
    }
    try {
      return this.clientFactory({
        host: configuration.host,
        port: configuration.port,
        secure: configuration.secure,
        auth:
          credential.kind === "imap_password"
            ? { user: credential.username, pass: credential.password }
            : {
                user: credential.username,
                accessToken: credential.accessToken,
              },
      });
    } catch {
      throw new ImapSyncError();
    }
  }

  private async readBatch(
    input: ImapSyncInput,
    configuration: ValidatedConfiguration,
    cursor: Cursor | null,
    client: ImapClient,
  ): Promise<ApplyInboxSyncBatch> {
    const mailbox = validMailbox(client.mailbox);
    const uidValidity = String(mailbox.uidValidity);
    const reset = !cursor || cursor.uidValidity !== uidValidity;
    const lastUid = reset ? 0 : cursor.lastUid;
    const nextCursor = (value: number) =>
      JSON.stringify({ version: 3, uidValidity, lastUid: value });

    if (mailbox.exists === 0) {
      return emptyBatch(input.account, nextCursor(0), this.clock());
    }
    if (!reset && lastUid >= mailbox.uidNext - 1) {
      return emptyBatch(input.account, nextCursor(lastUid), this.clock());
    }

    const startUid = reset
      ? Math.max(1, mailbox.uidNext - configuration.maxInitialMessages)
      : lastUid + 1;
    const metadata = await client.fetchAll(
      `${startUid}:*`,
      {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        size: true,
        threadId: true,
        labels: true,
      },
      { uid: true },
    );
    const sorted = metadata
      .filter((item) => Number.isInteger(item.uid) && item.uid > 0)
      .sort((a, b) => a.uid - b.uid);
    const messages: SyncMessage[] = [];
    const calendarInvitations: ApplyInboxSyncBatch["calendarInvitations"] = [];
    const threadInputs: ThreadInput[] = [];
    for (const item of sorted) {
      const download = await client.download(String(item.uid), undefined, {
        uid: true,
        maxBytes: configuration.maxMessageBytes,
      });
      const parsed = await simpleParser(
        await collectLimited(download.content, configuration.maxMessageBytes),
      );
      const normalized = normalizeMessage(
        input.account,
        item,
        parsed,
        uidValidity,
      );
      messages.push(normalized.message);
      calendarInvitations.push(
        ...calendarInvitationsFrom(
          parsed,
          normalized.message.externalMessageId,
        ),
      );
      threadInputs.push(normalized.thread);
    }
    const maxUid = sorted.reduce(
      (highest, item) => Math.max(highest, item.uid),
      lastUid,
    );
    return {
      accountId: input.account.id,
      previousCursor: input.account.syncCursor,
      nextCursor: nextCursor(maxUid),
      threads: groupThreads(threadInputs),
      messages,
      calendarInvitations,
      syncedAt: this.clock().toISOString(),
    };
  }
}

function validCredential(
  credential: ConnectorCredential | null,
): credential is Extract<
  ConnectorCredential,
  { kind: "imap_password" | "oauth" }
> {
  return Boolean(
    credential &&
    (credential.kind === "imap_password" || credential.kind === "oauth") &&
    typeof credential.username === "string" &&
    credential.username.trim().length > 0 &&
    (credential.kind === "imap_password"
      ? typeof credential.password === "string" &&
        credential.password.length > 0
      : typeof credential.accessToken === "string" &&
        credential.accessToken.length > 0),
  );
}

function resolveDestinationMailbox(
  mailboxes: Array<{ path: string; specialUse?: string }>,
  destination: InboxThreadDestination,
  provider: ConnectorAccount["provider"],
): string {
  const specialUse = destination === "trash" ? "\\Trash" : "\\Junk";
  const discovered = mailboxes.find(
    (mailbox) => mailbox.specialUse?.toLowerCase() === specialUse.toLowerCase(),
  );
  if (discovered) return discovered.path;
  if (provider === "gmail") {
    return destination === "trash" ? "[Gmail]/Trash" : "[Gmail]/Spam";
  }
  return destination === "trash" ? "Trash" : "Junk";
}

async function resolveMessageUids(
  client: ImapClient,
  externalMessageIds: string[],
): Promise<number[]> {
  const uids = new Set<number>();
  for (const externalMessageId of externalMessageIds) {
    const fallbackUid = fallbackMessageUid(externalMessageId);
    if (fallbackUid !== null) {
      uids.add(fallbackUid);
      continue;
    }
    const matches = await client.search(
      { header: { "message-id": externalMessageId } },
      { uid: true },
    );
    for (const uid of matches || []) {
      if (Number.isSafeInteger(uid) && uid > 0) uids.add(uid);
    }
  }
  return [...uids].sort((left, right) => left - right);
}

function fallbackMessageUid(externalMessageId: string): number | null {
  const match = /^imap:\d+:(\d+)$/u.exec(externalMessageId);
  if (!match) return null;
  const uid = Number(match[1]);
  return Number.isSafeInteger(uid) && uid > 0 ? uid : null;
}

const GMAIL_APP_PASSWORD_ERROR =
  "O Gmail recusou a conexão antiga. Reconecte a conta usando Entrar com Google.";
const GMAIL_CREDENTIAL_REJECTED_ERROR =
  "O Gmail recusou a credencial. Reconecte a conta usando Entrar com Google.";

function classifyImapFailure(
  cause: unknown,
  provider: ConnectorAccount["provider"],
): ImapSyncError {
  if (provider !== "gmail") return new ImapSyncError();
  const details = safeImapError(cause);
  const signal =
    `${details.errorCode ?? ""} ${details.message} ${details.serverResponse ?? ""}`.toLowerCase();
  if (
    signal.includes("application-specific password required") ||
    signal.includes("app password required")
  ) {
    return new ImapSyncError(GMAIL_APP_PASSWORD_ERROR, "auth_required");
  }
  if (
    signal.includes("authenticationfailed") ||
    signal.includes("invalid credentials") ||
    signal.includes("authentication failed")
  ) {
    return new ImapSyncError(GMAIL_CREDENTIAL_REJECTED_ERROR, "auth_required");
  }
  return new ImapSyncError();
}

function safeImapError(cause: unknown): {
  errorName: string;
  errorCode: string | null;
  message: string;
  serverResponse: string | null;
} {
  if (!(cause instanceof Error)) {
    return {
      errorName: "UnknownError",
      errorCode: null,
      message: "Unknown IMAP failure",
      serverResponse: null,
    };
  }
  const value = cause as Error & {
    serverResponseCode?: unknown;
    code?: unknown;
    response?: unknown;
  };
  const errorCode =
    typeof value.serverResponseCode === "string"
      ? value.serverResponseCode
      : typeof value.code === "string"
        ? value.code
        : null;
  return {
    errorName: cause.name,
    errorCode,
    message: cause.message.slice(0, 500),
    serverResponse:
      typeof value.response === "string" ? value.response.slice(0, 500) : null,
  };
}

type ValidatedConfiguration = Required<ImapAccountConfiguration>;
type Cursor = { version: 3; uidValidity: string; lastUid: number };
type ThreadInput = {
  externalThreadId: string;
  subject: string;
  snippet: string;
  participants: string[];
  labels: string[];
  unread: boolean;
  timestamp: string;
};

function productionClientFactory(options: ImapClientOptions): ImapClient {
  return createProductionImapClient(options);
}

export function createProductionImapClient(
  options: ImapClientOptions,
  ImapFlowConstructor: ImapClientConstructor = ImapFlow as unknown as ImapClientConstructor,
): ImapClient {
  return new ImapFlowConstructor({
    ...options,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    logger: false,
  });
}

function validateConfiguration(
  value: ImapAccountConfiguration,
): ValidatedConfiguration {
  if (
    !value ||
    typeof value.host !== "string" ||
    value.host.trim().length === 0
  )
    throw new Error("invalid");
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
    throw new Error("invalid");
  if (typeof value.secure !== "boolean") throw new Error("invalid");
  const mailbox = value.mailbox ?? "INBOX";
  if (typeof mailbox !== "string" || mailbox.trim().length === 0)
    throw new Error("invalid");
  const maxInitialMessages =
    value.maxInitialMessages ?? DEFAULT_INITIAL_MESSAGES;
  const maxMessageBytes = value.maxMessageBytes ?? DEFAULT_MESSAGE_BYTES;
  if (
    !Number.isInteger(maxInitialMessages) ||
    maxInitialMessages < 1 ||
    maxInitialMessages > MAX_INITIAL_MESSAGES
  )
    throw new Error("invalid");
  if (
    !Number.isInteger(maxMessageBytes) ||
    maxMessageBytes < 1 ||
    maxMessageBytes > MAX_MESSAGE_BYTES
  )
    throw new Error("invalid");
  return {
    host: value.host.trim(),
    port: value.port,
    secure: value.secure,
    mailbox,
    maxInitialMessages,
    maxMessageBytes,
  };
}

function parseCursor(value: string | null): Cursor | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 3 ||
    !Object.hasOwn(parsed, "version") ||
    !Object.hasOwn(parsed, "uidValidity") ||
    !Object.hasOwn(parsed, "lastUid") ||
    ![1, 2, 3].includes(parsed.version as number) ||
    typeof parsed.uidValidity !== "string" ||
    !/^[0-9]+$/.test(parsed.uidValidity) ||
    typeof parsed.lastUid !== "number" ||
    !Number.isSafeInteger(parsed.lastUid) ||
    parsed.lastUid < 0
  )
    throw new Error("invalid");
  // Older cursors predate either HTML preservation or calendar invitation
  // extraction. Rehydrate the bounded recent window once, then persist v3.
  if (parsed.version === 1 || parsed.version === 2) return null;
  return {
    version: 3,
    uidValidity: parsed.uidValidity as string,
    lastUid: parsed.lastUid as number,
  };
}

function validMailbox(value: ImapMailboxState | undefined): ImapMailboxState {
  if (
    !value ||
    !Number.isInteger(value.uidNext) ||
    value.uidNext < 1 ||
    !Number.isInteger(value.exists) ||
    value.exists < 0 ||
    !/^[0-9]+$/.test(String(value.uidValidity))
  )
    throw new Error("invalid mailbox");
  return value;
}

async function collectLimited(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  maximum: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maximum) throw new Error("download too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function normalizeMessage(
  account: ConnectorAccount,
  item: ImapFetchedMessage,
  parsed: ParsedMail,
  uidValidity: string,
): { message: SyncMessage; thread: ThreadInput } {
  const externalMessageId =
    parsed.messageId || `imap:${uidValidity}:${item.uid}`;
  const externalThreadId =
    item.threadId ||
    firstReference(parsed.references) ||
    parsed.inReplyTo ||
    parsed.messageId ||
    `imap-thread:${uidValidity}:${item.uid}`;
  const sender =
    firstAddress(parsed.from) ||
    envelopeAddresses(item.envelope?.from)[0] ||
    "";
  if (!sender) throw new Error("missing sender");
  const recipients = unique([
    ...addresses(parsed.to),
    ...addresses(parsed.cc),
    ...addresses(parsed.bcc),
    ...envelopeAddresses(item.envelope?.to),
  ]);
  const htmlBody = typeof parsed.html === "string" ? parsed.html : "";
  const body = htmlBody || parsed.text || "";
  const bodyFormat = htmlBody ? "html" : "text";
  const labels = unique([
    ...(item.labels ? [...item.labels] : []),
    ...(item.flags ? [...item.flags] : []),
  ]).sort();
  const sentAt = parsed.date?.toISOString() ?? null;
  const receivedAt = dateToIso(item.internalDate);
  const timestamp = receivedAt || sentAt || "1970-01-01T00:00:00.000Z";
  const participants = unique([sender, ...recipients].filter(Boolean));
  const subject =
    parsed.subject?.trim() || item.envelope?.subject?.trim() || "(sem assunto)";
  return {
    message: {
      externalMessageId,
      threadExternalId: externalThreadId,
      direction:
        sender.toLowerCase() === account.address.trim().toLowerCase()
          ? "outgoing"
          : "incoming",
      sender,
      recipients,
      body,
      bodyFormat,
      sentAt,
      receivedAt,
      attachments: parsed.attachments.map(toAttachment),
    },
    thread: {
      externalThreadId,
      subject,
      snippet:
        snippet(
          parsed.text || (typeof parsed.html === "string" ? parsed.html : ""),
        ) || "Sem prévia disponível",
      participants,
      labels,
      unread: !item.flags?.has("\\Seen"),
      timestamp,
    },
  };
}

function groupThreads(inputs: ThreadInput[]): SyncThread[] {
  const groups = new Map<string, ThreadInput[]>();
  for (const input of inputs)
    groups.set(input.externalThreadId, [
      ...(groups.get(input.externalThreadId) ?? []),
      input,
    ]);
  return [...groups.entries()]
    .map(([externalThreadId, group]) => {
      const latest = [...group].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      )[0];
      return {
        externalThreadId,
        subject: latest.subject,
        snippet: latest.snippet,
        participants: unique(group.flatMap((entry) => entry.participants)),
        unreadCount: group.filter((entry) => entry.unread).length,
        lastMessageAt: latest.timestamp,
        labels: unique(group.flatMap((entry) => entry.labels)).sort(),
      };
    })
    .sort((a, b) => a.externalThreadId.localeCompare(b.externalThreadId));
}

function emptyBatch(
  account: ConnectorAccount,
  nextCursor: string,
  clock: Date,
): ApplyInboxSyncBatch {
  return {
    accountId: account.id,
    previousCursor: account.syncCursor,
    nextCursor,
    threads: [],
    messages: [],
    calendarInvitations: [],
    syncedAt: clock.toISOString(),
  };
}

function calendarInvitationsFrom(
  parsed: ParsedMail,
  externalMessageId: string,
): NonNullable<ApplyInboxSyncBatch["calendarInvitations"]> {
  return parsed.attachments.flatMap((attachment) => {
    const isCalendar =
      attachment.contentType?.toLowerCase() === "text/calendar" ||
      attachment.filename?.toLowerCase().endsWith(".ics") === true;
    if (
      !isCalendar ||
      !Buffer.isBuffer(attachment.content) ||
      attachment.content.length === 0 ||
      attachment.content.length > MAX_CALENDAR_INVITATION_BYTES
    ) {
      return [];
    }
    const payload = attachment.content.toString("utf8");
    return /BEGIN:VCALENDAR/iu.test(payload)
      ? [{ externalMessageId, payload }]
      : [];
  });
}

function toAttachment(
  attachment: ParsedMail["attachments"][number],
): InboxAttachment {
  return {
    ...(attachment.filename ? { filename: attachment.filename } : {}),
    ...(attachment.contentType ? { mimeType: attachment.contentType } : {}),
    ...(Number.isFinite(attachment.size) ? { size: attachment.size } : {}),
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
    ...(attachment.contentDisposition === "inline" ||
    attachment.contentDisposition === "attachment"
      ? { disposition: attachment.contentDisposition }
      : {}),
  };
}

function firstReference(value: ParsedMail["references"]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function firstAddress(value: AddressObject | undefined): string {
  return addresses(value)[0] ?? "";
}

function addresses(
  value: AddressObject | AddressObject[] | undefined,
): string[] {
  const all = Array.isArray(value) ? value : value ? [value] : [];
  return all
    .flatMap((entry) => entry.value.map((address) => address.address ?? ""))
    .filter(Boolean);
}

function envelopeAddresses(
  value: Array<{ address?: string | null }> | undefined,
): string[] {
  return (
    value?.flatMap((entry) => (entry.address ? [entry.address] : [])) ?? []
  );
}

function dateToIso(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function snippet(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
