import { randomUUID } from "node:crypto";
import type { Database } from "../db/connection";

export type InboxAccountProvider = "gmail" | "outlook" | "zoho" | "imap";
export type InboxAccountStatus =
  | "connected"
  | "syncing"
  | "degraded"
  | "auth_required"
  | "paused"
  | "unavailable";
export type InboxMessageDirection = "incoming" | "outgoing" | "draft";
export type InboxBodyFormat = "text" | "html";

export interface ConnectorAccount {
  id: string;
  provider: InboxAccountProvider;
  displayName: string;
  address: string;
  status: InboxAccountStatus;
  syncCursor: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxThread {
  id: string;
  accountId: string;
  externalThreadId: string;
  subject: string;
  snippet: string;
  participants: string[];
  unreadCount: number;
  lastMessageAt: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InboxAttachment {
  providerAttachmentId?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  contentId?: string;
  disposition?: "attachment" | "inline";
}

export interface InboxMessage {
  id: string;
  accountId: string;
  threadId: string;
  externalMessageId: string;
  direction: InboxMessageDirection;
  sender: string;
  recipients: string[];
  body: string;
  bodyFormat: InboxBodyFormat;
  sentAt: string | null;
  receivedAt: string | null;
  attachments: InboxAttachment[];
  untrustedContent: true;
  createdAt: string;
  updatedAt: string;
}

export interface AddConnectorAccount {
  id?: string;
  provider: InboxAccountProvider;
  displayName: string;
  address: string;
  status?: InboxAccountStatus;
}

export interface SyncThread {
  externalThreadId: string;
  subject: string;
  snippet: string;
  participants: string[];
  unreadCount: number;
  lastMessageAt: string;
  labels: string[];
}

export interface SyncMessage {
  externalMessageId: string;
  threadExternalId?: string;
  threadId?: string;
  direction: InboxMessageDirection;
  sender: string;
  recipients: string[];
  body: string;
  bodyFormat: InboxBodyFormat;
  sentAt: string | null;
  receivedAt: string | null;
  attachments: InboxAttachment[];
}

export interface InboxCalendarInvitation {
  externalMessageId: string;
  payload: string;
}

export interface ApplyInboxSyncBatch {
  accountId: string;
  previousCursor: string | null;
  nextCursor: string | null;
  threads: SyncThread[];
  messages: SyncMessage[];
  calendarInvitations?: InboxCalendarInvitation[];
  syncedAt: string;
}

export interface SyncBatchCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface InboxThreadCursor {
  lastMessageAt: string;
  id: string;
}

export interface ListInboxThreadsOptions {
  accountIds?: string[];
  unreadOnly?: boolean;
  limit?: number;
  cursor?: InboxThreadCursor;
}

export interface InboxThreadPage {
  threads: InboxThread[];
  nextCursor: InboxThreadCursor | null;
}

export interface InboxThreadDetail {
  thread: InboxThread;
  messages: InboxMessage[];
}

export class InboxInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxInvalidInputError";
  }
}

export class InboxAccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Inbox account ${accountId} was not found`);
    this.name = "InboxAccountNotFoundError";
  }
}

export class InboxThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Inbox thread ${threadId} was not found`);
    this.name = "InboxThreadNotFoundError";
  }
}

export class InboxCursorConflictError extends Error {
  constructor(
    accountId: string,
    expected: string | null,
    received: string | null,
  ) {
    super(
      `Inbox account ${accountId} cursor conflict: expected ${String(expected)}, received ${String(received)}`,
    );
    this.name = "InboxCursorConflictError";
  }
}

export class InboxAccountThreadMismatchError extends Error {
  constructor(accountId: string, threadId: string) {
    super(`Inbox thread ${threadId} does not belong to account ${accountId}`);
    this.name = "InboxAccountThreadMismatchError";
  }
}

interface AccountRow {
  id: string;
  provider: InboxAccountProvider;
  display_name: string;
  address: string;
  status: InboxAccountStatus;
  sync_cursor: string | null;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ThreadRow {
  id: string;
  account_id: string;
  external_thread_id: string;
  subject: string;
  snippet: string;
  participants_json: string;
  unread_count: number;
  last_message_at: string;
  labels_json: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  account_id: string;
  thread_id: string;
  external_message_id: string;
  direction: InboxMessageDirection;
  sender: string;
  recipients_json: string;
  body: string;
  body_format: InboxBodyFormat;
  sent_at: string | null;
  received_at: string | null;
  attachments_json: string;
  untrusted_content: number;
  created_at: string;
  updated_at: string;
}

const providers = new Set<InboxAccountProvider>([
  "gmail",
  "outlook",
  "zoho",
  "imap",
]);
const statuses = new Set<InboxAccountStatus>([
  "connected",
  "syncing",
  "degraded",
  "auth_required",
  "paused",
  "unavailable",
]);
const directions = new Set<InboxMessageDirection>([
  "incoming",
  "outgoing",
  "draft",
]);
const bodyFormats = new Set<InboxBodyFormat>(["text", "html"]);
const attachmentDispositions = new Set<
  NonNullable<InboxAttachment["disposition"]>
>(["attachment", "inline"]);
const attachmentKeys = new Set<keyof InboxAttachment>([
  "providerAttachmentId",
  "filename",
  "mimeType",
  "size",
  "contentId",
  "disposition",
]);

export class InboxService {
  constructor(private readonly db: Database) {}

  addAccount(input: AddConnectorAccount): ConnectorAccount {
    requireMember(input.provider, providers, "provider");
    requireMember(input.status ?? "connected", statuses, "status");
    const address = normalizeAddress(input.address);
    const now = new Date().toISOString();
    const record: ConnectorAccount = {
      id: input.id ?? randomUUID(),
      provider: input.provider,
      displayName: requireText(input.displayName, "displayName"),
      address,
      status: input.status ?? "connected",
      syncCursor: null,
      lastError: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.db
        .prepare(
          `INSERT INTO connector_accounts
           (id, provider, display_name, address, status, sync_cursor, last_error,
            last_synced_at, created_at, updated_at)
           VALUES (@id, @provider, @displayName, @address, @status, @syncCursor,
                   @lastError, @lastSyncedAt, @createdAt, @updatedAt)`,
        )
        .run(record);
    } catch (error) {
      if (isConstraint(error)) {
        throw new InboxInvalidInputError(
          `An account already exists for ${record.provider}:${record.address}`,
        );
      }
      throw error;
    }
    return record;
  }

  listAccounts(): ConnectorAccount[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM connector_accounts
           ORDER BY created_at ASC, provider ASC, address ASC, id ASC`,
        )
        .all() as AccountRow[]
    ).map(accountFromRow);
  }

  findAccount(id: string): ConnectorAccount | undefined {
    const row = this.db
      .prepare("SELECT * FROM connector_accounts WHERE id = ?")
      .get(id) as AccountRow | undefined;
    return row ? accountFromRow(row) : undefined;
  }

  setAccountStatus(
    id: string,
    status: InboxAccountStatus,
    lastError: string | null = null,
  ): ConnectorAccount {
    requireMember(status, statuses, "status");
    const changed = this.db
      .prepare(
        `UPDATE connector_accounts
         SET status = @status, last_error = @lastError, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({ id, status, lastError, updatedAt: new Date().toISOString() });
    if (changed.changes === 0) throw new InboxAccountNotFoundError(id);
    return this.requireAccount(id);
  }

  applySyncBatch(input: ApplyInboxSyncBatch): SyncBatchCounts {
    validateBatch(input);
    return this.db.transaction(() => {
      const account = this.requireAccount(input.accountId);
      if (account.syncCursor !== input.previousCursor) {
        throw new InboxCursorConflictError(
          input.accountId,
          account.syncCursor,
          input.previousCursor,
        );
      }

      const counts: SyncBatchCounts = { inserted: 0, updated: 0, unchanged: 0 };
      for (const thread of input.threads) {
        increment(
          counts,
          this.upsertThread(input.accountId, thread, input.syncedAt),
        );
      }
      for (const message of input.messages) {
        increment(
          counts,
          this.upsertMessage(input.accountId, message, input.syncedAt),
        );
      }
      this.db
        .prepare(
          `UPDATE connector_accounts
           SET sync_cursor = @nextCursor, last_synced_at = @syncedAt,
               updated_at = @syncedAt
           WHERE id = @accountId`,
        )
        .run(input);
      return counts;
    })();
  }

  listThreads(options: ListInboxThreadsOptions = {}): InboxThreadPage {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InboxInvalidInputError(
        "limit must be an integer from 1 to 100",
      );
    }
    if (
      options.cursor &&
      (!options.cursor.lastMessageAt || !options.cursor.id)
    ) {
      throw new InboxInvalidInputError("cursor requires lastMessageAt and id");
    }
    const filters: string[] = [];
    const parameters: Record<string, unknown> = { limit: limit + 1 };
    if (options.accountIds !== undefined) {
      if (options.accountIds.length === 0)
        return { threads: [], nextCursor: null };
      filters.push(
        `account_id IN (${options.accountIds.map((_, index) => `@account${index}`).join(", ")})`,
      );
      options.accountIds.forEach((id, index) => {
        parameters[`account${index}`] = id;
      });
    }
    if (options.unreadOnly) filters.push("unread_count > 0");
    if (options.cursor) {
      filters.push(
        "(last_message_at < @cursorLastMessageAt OR (last_message_at = @cursorLastMessageAt AND id < @cursorId))",
      );
      parameters.cursorLastMessageAt = options.cursor.lastMessageAt;
      parameters.cursorId = options.cursor.id;
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM inbox_threads
         ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
         ORDER BY last_message_at DESC, id DESC
         LIMIT @limit`,
      )
      .all(parameters) as ThreadRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(threadFromRow);
    const last = page.at(-1);
    return {
      threads: page,
      nextCursor:
        hasMore && last
          ? { lastMessageAt: last.lastMessageAt, id: last.id }
          : null,
    };
  }

  getThread(id: string): InboxThreadDetail {
    const thread = this.findThread(id);
    if (!thread) throw new InboxThreadNotFoundError(id);
    const messages = (
      this.db
        .prepare(
          `SELECT * FROM inbox_messages WHERE thread_id = ?
           ORDER BY COALESCE(sent_at, received_at) ASC, id ASC`,
        )
        .all(id) as MessageRow[]
    ).map(messageFromRow);
    return { thread, messages };
  }

  markThreadRead(id: string): InboxThread {
    const changed = this.db
      .prepare(
        `UPDATE inbox_threads
         SET unread_count = 0, updated_at = @updatedAt
         WHERE id = @id AND unread_count <> 0`,
      )
      .run({ id, updatedAt: new Date().toISOString() });
    const thread = this.findThread(id);
    if (!thread) throw new InboxThreadNotFoundError(id);
    if (changed.changes === 0) return thread;
    return thread;
  }

  private upsertThread(
    accountId: string,
    input: SyncThread,
    syncedAt: string,
  ): keyof SyncBatchCounts {
    validateThread(input);
    const current = this.findThreadByExternalId(
      accountId,
      input.externalThreadId,
    );
    const candidate = {
      accountId,
      externalThreadId: input.externalThreadId,
      subject: input.subject,
      snippet: input.snippet,
      participantsJson: canonicalSetJson(input.participants, normalizeAddress),
      unreadCount: input.unreadCount,
      lastMessageAt: input.lastMessageAt,
      labelsJson: canonicalSetJson(input.labels, normalizeLabel),
    };
    if (!current) {
      this.db
        .prepare(
          `INSERT INTO inbox_threads
           (id, account_id, external_thread_id, subject, snippet, participants_json,
            unread_count, last_message_at, labels_json, created_at, updated_at)
           VALUES (@id, @accountId, @externalThreadId, @subject, @snippet,
                   @participantsJson, @unreadCount, @lastMessageAt, @labelsJson,
                   @createdAt, @updatedAt)`,
        )
        .run({
          id: randomUUID(),
          ...candidate,
          createdAt: syncedAt,
          updatedAt: syncedAt,
        });
      return "inserted";
    }
    if (
      current.subject === candidate.subject &&
      current.snippet === candidate.snippet &&
      canonicalSetJson(current.participants, normalizeAddress) ===
        candidate.participantsJson &&
      current.unreadCount === candidate.unreadCount &&
      current.lastMessageAt === candidate.lastMessageAt &&
      canonicalSetJson(current.labels, normalizeLabel) === candidate.labelsJson
    ) {
      return "unchanged";
    }
    this.db
      .prepare(
        `UPDATE inbox_threads
         SET subject = @subject, snippet = @snippet, participants_json = @participantsJson,
             unread_count = @unreadCount, last_message_at = @lastMessageAt,
             labels_json = @labelsJson, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({ ...candidate, id: current.id, updatedAt: syncedAt });
    return "updated";
  }

  private upsertMessage(
    accountId: string,
    input: SyncMessage,
    syncedAt: string,
  ): keyof SyncBatchCounts {
    validateMessage(input);
    const thread = this.resolveMessageThread(accountId, input);
    const current = this.findMessageByExternalId(
      accountId,
      input.externalMessageId,
    );
    const candidate = {
      accountId,
      threadId: thread.id,
      externalMessageId: input.externalMessageId,
      direction: input.direction,
      sender: normalizeAddress(input.sender),
      recipientsJson: canonicalSetJson(input.recipients, normalizeAddress),
      body: input.body,
      bodyFormat: input.bodyFormat,
      sentAt: input.sentAt,
      receivedAt: input.receivedAt,
      attachmentsJson: canonicalJson(input.attachments),
    };
    if (!current) {
      this.db
        .prepare(
          `INSERT INTO inbox_messages
           (id, account_id, thread_id, external_message_id, direction, sender,
            recipients_json, body, body_format, sent_at, received_at,
            attachments_json, untrusted_content, created_at, updated_at)
           VALUES (@id, @accountId, @threadId, @externalMessageId, @direction,
                   @sender, @recipientsJson, @body, @bodyFormat, @sentAt,
                   @receivedAt, @attachmentsJson, 1, @createdAt, @updatedAt)`,
        )
        .run({
          id: randomUUID(),
          ...candidate,
          createdAt: syncedAt,
          updatedAt: syncedAt,
        });
      return "inserted";
    }
    if (
      current.threadId === candidate.threadId &&
      current.direction === candidate.direction &&
      current.sender === candidate.sender &&
      canonicalSetJson(current.recipients, normalizeAddress) ===
        candidate.recipientsJson &&
      current.body === candidate.body &&
      current.bodyFormat === candidate.bodyFormat &&
      current.sentAt === candidate.sentAt &&
      current.receivedAt === candidate.receivedAt &&
      canonicalJson(current.attachments) === candidate.attachmentsJson
    ) {
      return "unchanged";
    }
    this.db
      .prepare(
        `UPDATE inbox_messages
         SET thread_id = @threadId, direction = @direction, sender = @sender,
             recipients_json = @recipientsJson, body = @body, body_format = @bodyFormat,
             sent_at = @sentAt, received_at = @receivedAt,
             attachments_json = @attachmentsJson, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({ ...candidate, id: current.id, updatedAt: syncedAt });
    return "updated";
  }

  private resolveMessageThread(
    accountId: string,
    input: SyncMessage,
  ): InboxThread {
    const byId = input.threadId ? this.findThread(input.threadId) : undefined;
    if (byId && byId.accountId !== accountId) {
      throw new InboxAccountThreadMismatchError(accountId, byId.id);
    }
    const byExternalId = input.threadExternalId
      ? this.findThreadByExternalId(accountId, input.threadExternalId)
      : undefined;
    if (byId && byExternalId && byId.id !== byExternalId.id) {
      throw new InboxAccountThreadMismatchError(accountId, byId.id);
    }
    const thread = byId ?? byExternalId;
    if (thread) return thread;
    if (input.threadId) {
      const elsewhere = this.findThread(input.threadId);
      if (elsewhere)
        throw new InboxAccountThreadMismatchError(accountId, input.threadId);
    }
    throw new InboxInvalidInputError(
      "message must reference an existing thread in the same account",
    );
  }

  private requireAccount(id: string): ConnectorAccount {
    const account = this.findAccount(id);
    if (!account) throw new InboxAccountNotFoundError(id);
    return account;
  }

  private findThread(id: string): InboxThread | undefined {
    const row = this.db
      .prepare("SELECT * FROM inbox_threads WHERE id = ?")
      .get(id) as ThreadRow | undefined;
    return row ? threadFromRow(row) : undefined;
  }

  private findThreadByExternalId(
    accountId: string,
    externalThreadId: string,
  ): InboxThread | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM inbox_threads WHERE account_id = ? AND external_thread_id = ?",
      )
      .get(accountId, externalThreadId) as ThreadRow | undefined;
    return row ? threadFromRow(row) : undefined;
  }

  private findMessageByExternalId(
    accountId: string,
    externalMessageId: string,
  ): InboxMessage | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM inbox_messages WHERE account_id = ? AND external_message_id = ?",
      )
      .get(accountId, externalMessageId) as MessageRow | undefined;
    return row ? messageFromRow(row) : undefined;
  }
}

function accountFromRow(row: AccountRow): ConnectorAccount {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    address: row.address,
    status: row.status,
    syncCursor: row.sync_cursor,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function threadFromRow(row: ThreadRow): InboxThread {
  return {
    id: row.id,
    accountId: row.account_id,
    externalThreadId: row.external_thread_id,
    subject: row.subject,
    snippet: row.snippet,
    participants: JSON.parse(row.participants_json) as string[],
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
    labels: JSON.parse(row.labels_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row: MessageRow): InboxMessage {
  return {
    id: row.id,
    accountId: row.account_id,
    threadId: row.thread_id,
    externalMessageId: row.external_message_id,
    direction: row.direction,
    sender: row.sender,
    recipients: JSON.parse(row.recipients_json) as string[],
    body: row.body,
    bodyFormat: row.body_format,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    attachments: JSON.parse(row.attachments_json) as InboxAttachment[],
    untrustedContent:
      row.untrusted_content === 1 ? true : failUntrustedContent(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBatch(input: ApplyInboxSyncBatch): void {
  requireText(input.accountId, "accountId");
  if (
    input.previousCursor !== null &&
    typeof input.previousCursor !== "string"
  ) {
    throw new InboxInvalidInputError("previousCursor must be a string or null");
  }
  if (input.nextCursor !== null && typeof input.nextCursor !== "string") {
    throw new InboxInvalidInputError("nextCursor must be a string or null");
  }
  requireText(input.syncedAt, "syncedAt");
  if (!Array.isArray(input.threads) || !Array.isArray(input.messages)) {
    throw new InboxInvalidInputError("threads and messages must be arrays");
  }
}

function validateThread(input: SyncThread): void {
  requireText(input.externalThreadId, "externalThreadId");
  requireText(input.subject, "subject");
  requireText(input.snippet, "snippet");
  requireText(input.lastMessageAt, "lastMessageAt");
  if (!Number.isInteger(input.unreadCount) || input.unreadCount < 0) {
    throw new InboxInvalidInputError(
      "unreadCount must be a non-negative integer",
    );
  }
  validateTextList(input.participants, "participants");
  validateTextList(input.labels, "labels");
}

function validateMessage(input: SyncMessage): void {
  requireText(input.externalMessageId, "externalMessageId");
  if (!input.threadId && !input.threadExternalId) {
    throw new InboxInvalidInputError(
      "message requires threadId or threadExternalId",
    );
  }
  if (input.threadId) requireText(input.threadId, "threadId");
  if (input.threadExternalId)
    requireText(input.threadExternalId, "threadExternalId");
  requireMember(input.direction, directions, "direction");
  requireText(input.sender, "sender");
  validateTextList(input.recipients, "recipients");
  if (typeof input.body !== "string") {
    throw new InboxInvalidInputError("body must be a string");
  }
  requireMember(input.bodyFormat, bodyFormats, "bodyFormat");
  if (input.sentAt !== null && typeof input.sentAt !== "string") {
    throw new InboxInvalidInputError("sentAt must be a string or null");
  }
  if (input.receivedAt !== null && typeof input.receivedAt !== "string") {
    throw new InboxInvalidInputError("receivedAt must be a string or null");
  }
  if (!Array.isArray(input.attachments)) {
    throw new InboxInvalidInputError("attachments must be an array");
  }
  input.attachments.forEach(validateAttachment);
  canonicalJson(input.attachments);
}

function validateAttachment(value: unknown, index: number): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new InboxInvalidInputError(
      `attachments[${index}] must be a metadata object`,
    );
  }
  const attachment = value as Record<string, unknown>;
  for (const key of Object.keys(attachment)) {
    if (!attachmentKeys.has(key as keyof InboxAttachment)) {
      throw new InboxInvalidInputError(
        `attachments[${index}] contains unsupported metadata ${key}`,
      );
    }
  }
  for (const key of [
    "providerAttachmentId",
    "filename",
    "mimeType",
    "contentId",
  ] as const) {
    const field = attachment[key];
    if (field !== undefined) requireText(field, `attachments[${index}].${key}`);
  }
  if (
    attachment.size !== undefined &&
    (!Number.isInteger(attachment.size) || (attachment.size as number) < 0)
  ) {
    throw new InboxInvalidInputError(
      `attachments[${index}].size must be a non-negative integer`,
    );
  }
  if (
    attachment.disposition !== undefined &&
    !attachmentDispositions.has(
      attachment.disposition as NonNullable<InboxAttachment["disposition"]>,
    )
  ) {
    throw new InboxInvalidInputError(
      `attachments[${index}].disposition is invalid`,
    );
  }
}

function validateTextList(
  value: unknown,
  name: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new InboxInvalidInputError(`${name} must be an array of strings`);
  }
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InboxInvalidInputError(`${name} is required`);
  }
  return value.trim();
}

function requireMember<T>(value: T, allowed: Set<T>, name: string): T {
  if (!allowed.has(value)) throw new InboxInvalidInputError(`invalid ${name}`);
  return value;
}

function normalizeAddress(value: string): string {
  return requireText(value, "address").toLowerCase();
}

function normalizeLabel(value: string): string {
  return requireText(value, "label").toLowerCase();
}

function canonicalSetJson(
  values: string[],
  normalize: (value: string) => string,
): string {
  return canonicalJson([...new Set(values.map(normalize))].sort());
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InboxInvalidInputError("JSON values must be finite");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  throw new InboxInvalidInputError("values must be JSON-serializable");
}

function increment(counts: SyncBatchCounts, kind: keyof SyncBatchCounts): void {
  counts[kind] += 1;
}

function isConstraint(error: unknown): boolean {
  return error instanceof Error && /constraint/i.test(error.message);
}

function failUntrustedContent(): never {
  throw new InboxInvalidInputError("stored inbox message must be untrusted");
}
