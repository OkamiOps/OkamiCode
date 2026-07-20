import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { ConnectorCredential } from "../connectors/credential-vault";
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
    options: { readOnly: true },
  ): Promise<{ release(): void }>;
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
  logger?: false;
};

export type ImapClientFactory = (options: ImapClientOptions) => ImapClient;
export type ImapClientConstructor = new (
  options: ImapClientOptions & { logger: false },
) => ImapClient;

export interface CredentialReader {
  get(accountId: string): Promise<ConnectorCredential | null>;
}

export class ImapSyncError extends Error {
  constructor(message = "IMAP synchronization failed") {
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

    let credential: ConnectorCredential | null;
    try {
      credential = await this.vault.get(input.account.id);
    } catch {
      throw new ImapSyncError("IMAP credentials unavailable");
    }
    if (!credential) throw new ImapSyncError("IMAP credentials unavailable");
    if (
      (credential.kind !== "imap_password" && credential.kind !== "oauth") ||
      typeof credential.username !== "string" ||
      credential.username.trim().length === 0 ||
      (credential.kind === "imap_password" &&
        (typeof credential.password !== "string" ||
          credential.password.length === 0)) ||
      (credential.kind === "oauth" &&
        (typeof credential.accessToken !== "string" ||
          credential.accessToken.length === 0))
    ) {
      throw new ImapSyncError("IMAP credentials unavailable");
    }

    let client: ImapClient;
    try {
      client = this.clientFactory({
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

    let lock: { release(): void } | undefined;
    let primaryFailed = false;
    let result: ApplyInboxSyncBatch | undefined;
    try {
      await client.connect();
      lock = await client.getMailboxLock(configuration.mailbox, {
        readOnly: true,
      });
      result = await this.readBatch(input, configuration, cursor, client);
    } catch {
      primaryFailed = true;
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
    if (primaryFailed || cleanupFailed || !result) throw new ImapSyncError();
    return result;
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
      JSON.stringify({ version: 1, uidValidity, lastUid: value });

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
      syncedAt: this.clock().toISOString(),
    };
  }
}

type ValidatedConfiguration = Required<ImapAccountConfiguration>;
type Cursor = { version: 1; uidValidity: string; lastUid: number };
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
  return new ImapFlowConstructor({ ...options, logger: false });
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
    parsed.version !== 1 ||
    typeof parsed.uidValidity !== "string" ||
    !/^[0-9]+$/.test(parsed.uidValidity) ||
    typeof parsed.lastUid !== "number" ||
    !Number.isSafeInteger(parsed.lastUid) ||
    parsed.lastUid < 0
  )
    throw new Error("invalid");
  return {
    version: 1,
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
  const body =
    parsed.text || (typeof parsed.html === "string" ? parsed.html : "");
  const bodyFormat = parsed.text ? "text" : "html";
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
      snippet: snippet(
        parsed.text || (typeof parsed.html === "string" ? parsed.html : ""),
      ),
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
    syncedAt: clock.toISOString(),
  };
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
