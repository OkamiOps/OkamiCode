import type { Database } from "../db/connection";
import {
  ExternalOutboxConflictError,
  ExternalOutboxService,
  type ExternalOutboxRecord,
  type ExternalOutboxStatus,
} from "../outbox/service";
import {
  InboxService,
  InboxThreadNotFoundError,
  type InboxMessage,
  type InboxThreadDetail,
} from "./service";
import { InboxOutgoingSettingsService } from "./outgoing-settings-service";

export interface CreateInboxThreadReplyDraftInput {
  threadId: string;
  body: string;
  fromAddress?: string;
  idempotencyKey: string;
}

export interface CreateInboxThreadForwardDraftInput {
  threadId: string;
  to: string[];
  note?: string;
  fromAddress?: string;
  idempotencyKey: string;
}

export interface InboxThreadReplyAction {
  id: string;
  sourceThreadId: string;
  connectorAccountId: string;
  fromAddress: string | null;
  messageType: "reply" | "forward";
  to: string[];
  subject: string;
  body: string;
  status: ExternalOutboxStatus;
  requiresApproval: boolean;
  safeRetry: boolean;
  attempts: number;
  approvedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxThreadReplyDraftResult {
  id: string;
  sourceThreadId: string;
  connectorAccountId: string;
  fromAddress: string | null;
  messageType: "reply" | "forward";
  to: string[];
  subject: string;
  body: string;
  status: "approval_pending";
  requiresApproval: true;
  safeRetry: false;
  attempts: 0;
  createdAt: string;
  updatedAt: string;
}

export interface DiscardInboxReplyResult {
  outboxId: string;
  sourceThreadId: string;
  discarded: true;
}

interface EmailReplyPayload {
  threadId: string;
  externalThreadId: string;
  inReplyTo: string;
  to: [string];
  subject: string;
  body: string;
  fromAddress?: string;
}

interface EmailForwardPayload {
  threadId: string;
  externalThreadId: string;
  sourceMessageId: string;
  to: string[];
  subject: string;
  body: string;
  note: string;
  fromAddress?: string;
}

type EmailActionPayload = EmailReplyPayload | EmailForwardPayload;
type EmailActionType = InboxThreadReplyAction["messageType"];

export class InboxReplyDraftThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Inbox thread ${threadId} was not found`);
    this.name = "InboxReplyDraftThreadNotFoundError";
  }
}

export class InboxReplyDraftNoIncomingMessageError extends Error {
  constructor(threadId: string) {
    super(`Inbox thread ${threadId} has no incoming message to reply to`);
    this.name = "InboxReplyDraftNoIncomingMessageError";
  }
}

export class InboxReplyDraftService {
  private readonly db: Database;
  private readonly inbox: InboxService;
  private readonly outbox: ExternalOutboxService;

  constructor({ db }: { db: Database }) {
    this.db = db;
    this.inbox = new InboxService(db);
    this.outbox = new ExternalOutboxService(db);
  }

  createReplyDraft(
    input: CreateInboxThreadReplyDraftInput,
  ): InboxThreadReplyDraftResult {
    const body = normalizeBody(input.body);
    const replay = this.replayExisting(
      input.threadId,
      body,
      input.idempotencyKey,
    );
    if (replay) return replay;

    const detail = this.readThread(input.threadId);
    const incoming = latestIncoming(detail.messages);
    if (!incoming) {
      throw new InboxReplyDraftNoIncomingMessageError(input.threadId);
    }

    const payload: EmailReplyPayload = {
      threadId: detail.thread.id,
      externalThreadId: detail.thread.externalThreadId,
      inReplyTo: incoming.externalMessageId,
      to: [incoming.sender.trim()],
      subject: replySubject(detail),
      body,
      fromAddress: this.resolveFromAddress(
        detail.thread.accountId,
        input.fromAddress,
      ),
    };
    const draft = this.outbox.createDraft({
      connectorAccountId: detail.thread.accountId,
      kind: "email.reply",
      payload,
      idempotencyKey: input.idempotencyKey,
      requiresApproval: true,
      safeRetry: false,
    });
    const pending = this.outbox.requestApproval(draft.id);
    return responseFromRecord(pending, payload, "reply");
  }

  createForwardDraft(
    input: CreateInboxThreadForwardDraftInput,
  ): InboxThreadReplyDraftResult {
    const recipients = normalizeRecipients(input.to);
    const note = normalizeForwardNote(input.note);
    const replay = this.replayForwardExisting(
      input.threadId,
      recipients,
      note,
      input.idempotencyKey,
    );
    if (replay) return replay;

    const detail = this.readThread(input.threadId);
    const source = latestForwardable(detail.messages);
    if (!source) {
      throw new Error("Inbox thread has no message to forward");
    }
    const payload: EmailForwardPayload = {
      threadId: detail.thread.id,
      externalThreadId: detail.thread.externalThreadId,
      sourceMessageId: source.externalMessageId,
      to: recipients,
      subject: forwardSubject(detail),
      body: forwardedBody(detail, source, note),
      note,
      fromAddress: this.resolveFromAddress(
        detail.thread.accountId,
        input.fromAddress,
      ),
    };
    const draft = this.outbox.createDraft({
      connectorAccountId: detail.thread.accountId,
      kind: "email.forward",
      payload,
      idempotencyKey: input.idempotencyKey,
      requiresApproval: true,
      safeRetry: false,
    });
    const pending = this.outbox.requestApproval(draft.id);
    return responseFromRecord(pending, payload, "forward");
  }

  private resolveFromAddress(accountId: string, requested?: string): string {
    const account = this.db
      .prepare("SELECT address FROM connector_accounts WHERE id = ?")
      .get(accountId) as { address: string } | undefined;
    if (!account) throw new InboxReplyDraftThreadNotFoundError(accountId);
    const primary = account.address.trim().toLowerCase();
    const aliases =
      new InboxOutgoingSettingsService({ db: this.db }).get(accountId)
        ?.fromAddresses ?? [];
    const selected = requested?.trim().toLowerCase() || primary;
    if (![primary, ...aliases].includes(selected)) {
      throw new Error("Selected sender address is not configured");
    }
    return selected;
  }

  private readThread(threadId: string): InboxThreadDetail {
    try {
      return this.inbox.getThread(threadId);
    } catch (error) {
      if (!(error instanceof InboxThreadNotFoundError)) throw error;
      throw new InboxReplyDraftThreadNotFoundError(threadId);
    }
  }

  private replayExisting(
    threadId: string,
    body: string,
    idempotencyKey: string,
  ): InboxThreadReplyDraftResult | undefined {
    const record = this.outbox.findByIdempotencyKey(idempotencyKey);
    if (!record) return undefined;

    const payload = emailReplyPayload(record.payload);
    if (
      record.kind !== "email.reply" ||
      !payload ||
      payload.threadId !== threadId ||
      payload.body !== body
    ) {
      throw new ExternalOutboxConflictError(idempotencyKey);
    }
    return responseFromRecord(
      this.outbox.requestApproval(record.id),
      payload,
      "reply",
    );
  }

  private replayForwardExisting(
    threadId: string,
    to: string[],
    note: string,
    idempotencyKey: string,
  ): InboxThreadReplyDraftResult | undefined {
    const record = this.outbox.findByIdempotencyKey(idempotencyKey);
    if (!record) return undefined;
    const payload = emailForwardPayload(record.payload);
    if (
      record.kind !== "email.forward" ||
      !payload ||
      payload.threadId !== threadId ||
      payload.note !== note ||
      payload.to.length !== to.length ||
      payload.to.some((recipient, index) => recipient !== to[index])
    ) {
      throw new ExternalOutboxConflictError(idempotencyKey);
    }
    return responseFromRecord(
      this.outbox.requestApproval(record.id),
      payload,
      "forward",
    );
  }

  listReplyActions(threadId: string): InboxThreadReplyAction[] {
    const dismissed = new Set(
      (
        this.db
          .prepare(
            "SELECT outbox_id FROM inbox_reply_dismissals WHERE source_thread_id = ?",
          )
          .all(threadId) as Array<{ outbox_id: string }>
      ).map((row) => row.outbox_id),
    );
    return this.outbox
      .list()
      .flatMap((record) => {
        const action = emailActionPayload(record);
        if (
          !action ||
          action.payload.threadId !== threadId ||
          dismissed.has(record.id) ||
          !isPublicReplyAction(record, action.payload)
        ) {
          return [];
        }
        return [responseFromAction(record, action.payload, action.messageType)];
      })
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      );
  }

  discardReplyAction(
    threadId: string,
    outboxId: string,
  ): DiscardInboxReplyResult {
    const record = this.outbox.findById(outboxId);
    const action = record ? emailActionPayload(record) : undefined;
    if (!record || !action || action.payload.threadId !== threadId) {
      throw new Error("Reply draft was not found for this thread");
    }
    if (
      (record.status !== "draft" && record.status !== "approval_pending") ||
      record.approvedAt !== null ||
      record.attempts !== 0
    ) {
      throw new Error("Only unsent reply drafts can be discarded");
    }
    this.db
      .prepare(
        `INSERT INTO inbox_reply_dismissals
         (outbox_id, source_thread_id, dismissed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(outbox_id) DO NOTHING`,
      )
      .run(outboxId, threadId, new Date().toISOString());
    return { outboxId, sourceThreadId: threadId, discarded: true };
  }
}

function normalizeBody(body: string): string {
  const normalized = body.trim();
  if (!normalized) throw new Error("Reply body cannot be empty");
  if (normalized.length > 20_000) {
    throw new Error("Reply body must be at most 20,000 characters");
  }
  return normalized;
}

function normalizeRecipients(recipients: string[]): string[] {
  const normalized = [
    ...new Set(recipients.map((value) => value.trim().toLowerCase())),
  ].filter(Boolean);
  if (
    normalized.length === 0 ||
    normalized.length > 20 ||
    normalized.some(
      (value) =>
        value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value),
    )
  ) {
    throw new Error("Enter at least one valid recipient");
  }
  return normalized;
}

function normalizeForwardNote(note: string | undefined): string {
  const normalized = note?.trim() ?? "";
  if (normalized.length > 20_000) {
    throw new Error("Forward note must be at most 20,000 characters");
  }
  return normalized;
}

function latestIncoming(messages: InboxMessage[]): InboxMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.direction === "incoming" &&
        message.sender.trim().length > 0 &&
        message.externalMessageId.trim().length > 0,
    );
}

function latestForwardable(messages: InboxMessage[]): InboxMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.externalMessageId.trim().length > 0 &&
        message.body.trim().length > 0,
    );
}

function replySubject(detail: InboxThreadDetail): string {
  let subject = detail.thread.subject.trim();
  while (/^re\s*:\s*/iu.test(subject)) {
    subject = subject.replace(/^re\s*:\s*/iu, "");
  }
  const value = subject ? `Re: ${subject}` : "Re: (sem assunto)";
  return value.slice(0, 2_000);
}

function forwardSubject(detail: InboxThreadDetail): string {
  let subject = detail.thread.subject.trim();
  while (/^(?:re|fwd?|enc)\s*:\s*/iu.test(subject)) {
    subject = subject.replace(/^(?:re|fwd?|enc)\s*:\s*/iu, "");
  }
  return `Enc: ${subject || "(sem assunto)"}`.slice(0, 2_000);
}

function forwardedBody(
  detail: InboxThreadDetail,
  message: InboxMessage,
  note: string,
): string {
  const original =
    message.bodyFormat === "html"
      ? htmlToReadableText(message.body)
      : message.body;
  const attachments = message.attachments
    .map((attachment) => attachment.filename?.trim())
    .filter((filename): filename is string => Boolean(filename));
  const sections = [
    note,
    "---------- Mensagem encaminhada ----------",
    `De: ${message.sender}`,
    `Data: ${message.receivedAt ?? message.sentAt ?? "indisponível"}`,
    `Assunto: ${detail.thread.subject || "(sem assunto)"}`,
    `Para: ${message.recipients.join(", ") || "indisponível"}`,
    attachments.length
      ? `Anexos no email original: ${attachments.join(", ")} (não incluídos)`
      : "",
    original.trim(),
  ].filter(Boolean);
  return sections.join("\n").slice(0, 100_000).trim();
}

function htmlToReadableText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(
        /<(?:script|style|head)[^>]*>[\s\S]*?<\/(?:script|style|head)>/giu,
        "",
      )
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr)>/giu, "\n")
      .replace(/<li[^>]*>/giu, "• ")
      .replace(/<[^>]+>/gu, "")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/giu,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const hexadecimal = entity[1]?.toLowerCase() === "x";
        const code = Number.parseInt(
          entity.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return named[entity.toLowerCase()] ?? match;
    },
  );
}

function emailReplyPayload(value: unknown): EmailReplyPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const requiredKeys = [
    "threadId",
    "externalThreadId",
    "inReplyTo",
    "to",
    "subject",
    "body",
  ];
  const allowedKeys = [...requiredKeys, "fromAddress"];
  if (
    !Object.keys(payload).every((key) => allowedKeys.includes(key)) ||
    !requiredKeys.every((key) => key in payload) ||
    !requiredKeys
      .filter((key) => key !== "to")
      .every((key) => typeof payload[key] === "string") ||
    (payload.fromAddress !== undefined &&
      typeof payload.fromAddress !== "string") ||
    !Array.isArray(payload.to) ||
    payload.to.length !== 1 ||
    typeof payload.to[0] !== "string"
  ) {
    return undefined;
  }
  return {
    threadId: payload.threadId as string,
    externalThreadId: payload.externalThreadId as string,
    inReplyTo: payload.inReplyTo as string,
    to: [payload.to[0]],
    subject: payload.subject as string,
    body: payload.body as string,
    ...(typeof payload.fromAddress === "string"
      ? { fromAddress: payload.fromAddress }
      : {}),
  };
}

function emailForwardPayload(value: unknown): EmailForwardPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const requiredKeys = [
    "threadId",
    "externalThreadId",
    "sourceMessageId",
    "to",
    "subject",
    "body",
    "note",
  ];
  const allowedKeys = [...requiredKeys, "fromAddress"];
  if (
    !Object.keys(payload).every((key) => allowedKeys.includes(key)) ||
    !requiredKeys.every((key) => key in payload) ||
    !requiredKeys
      .filter((key) => key !== "to")
      .every((key) => typeof payload[key] === "string") ||
    (payload.fromAddress !== undefined &&
      typeof payload.fromAddress !== "string") ||
    !Array.isArray(payload.to) ||
    payload.to.length === 0 ||
    payload.to.length > 20 ||
    payload.to.some((recipient) => typeof recipient !== "string")
  ) {
    return undefined;
  }
  return {
    threadId: payload.threadId as string,
    externalThreadId: payload.externalThreadId as string,
    sourceMessageId: payload.sourceMessageId as string,
    to: payload.to as string[],
    subject: payload.subject as string,
    body: payload.body as string,
    note: payload.note as string,
    ...(typeof payload.fromAddress === "string"
      ? { fromAddress: payload.fromAddress }
      : {}),
  };
}

function emailActionPayload(
  record: ExternalOutboxRecord,
): { payload: EmailActionPayload; messageType: EmailActionType } | undefined {
  if (record.kind === "email.reply") {
    const payload = emailReplyPayload(record.payload);
    return payload ? { payload, messageType: "reply" } : undefined;
  }
  if (record.kind === "email.forward") {
    const payload = emailForwardPayload(record.payload);
    return payload ? { payload, messageType: "forward" } : undefined;
  }
  return undefined;
}

function responseFromRecord(
  record: ExternalOutboxRecord,
  payload: EmailActionPayload,
  messageType: EmailActionType,
): InboxThreadReplyDraftResult {
  if (
    record.status !== "approval_pending" ||
    !record.requiresApproval ||
    record.approvedAt !== null ||
    record.safeRetry ||
    record.attempts !== 0
  ) {
    throw new Error(`Unexpected reply draft state: ${record.status}`);
  }
  const action = responseFromAction(record, payload, messageType);
  return {
    id: action.id,
    sourceThreadId: action.sourceThreadId,
    connectorAccountId: action.connectorAccountId,
    fromAddress: action.fromAddress,
    messageType: action.messageType,
    to: action.to,
    subject: action.subject,
    body: action.body,
    status: "approval_pending",
    requiresApproval: true,
    safeRetry: false,
    attempts: 0,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

function responseFromAction(
  record: ExternalOutboxRecord,
  payload: EmailActionPayload,
  messageType: EmailActionType,
): InboxThreadReplyAction {
  return {
    id: record.id,
    sourceThreadId: payload.threadId,
    connectorAccountId: record.connectorAccountId,
    fromAddress: payload.fromAddress ?? null,
    messageType,
    to: payload.to,
    subject: payload.subject,
    body: payload.body,
    status: record.status,
    requiresApproval: record.requiresApproval,
    safeRetry: record.safeRetry,
    attempts: record.attempts,
    approvedAt: record.approvedAt,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isPublicReplyAction(
  record: ExternalOutboxRecord,
  payload: EmailActionPayload,
): boolean {
  return (
    isUuid(record.id) &&
    isUuid(record.connectorAccountId) &&
    isUuid(payload.threadId) &&
    isBoundedText(payload.externalThreadId, 2_000) &&
    ("inReplyTo" in payload
      ? isBoundedText(payload.inReplyTo, 2_000)
      : isBoundedText(payload.sourceMessageId, 2_000)) &&
    (payload.fromAddress === undefined ||
      isBoundedText(payload.fromAddress, 320)) &&
    payload.to.length >= 1 &&
    payload.to.length <= 20 &&
    payload.to.every((recipient) => isBoundedText(recipient, 320)) &&
    isBoundedText(payload.subject, 2_000) &&
    isBoundedText(payload.body, messageTypeBodyMaximum(record.kind)) &&
    isOutboxStatus(record.status) &&
    typeof record.requiresApproval === "boolean" &&
    typeof record.safeRetry === "boolean" &&
    Number.isInteger(record.attempts) &&
    record.attempts >= 0 &&
    (record.approvedAt === null || isIsoDateTime(record.approvedAt)) &&
    (record.lastError === null || isBoundedText(record.lastError, Infinity)) &&
    isIsoDateTime(record.createdAt) &&
    isIsoDateTime(record.updatedAt)
  );
}

function messageTypeBodyMaximum(kind: string): number {
  return kind === "email.forward" ? 100_000 : 20_000;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function isIsoDateTime(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) && !Number.isNaN(Date.parse(value))
  );
}

function isOutboxStatus(value: unknown): value is ExternalOutboxStatus {
  return [
    "draft",
    "approval_pending",
    "dispatching",
    "confirmed",
    "uncertain",
    "failed_retryable",
    "failed_terminal",
  ].includes(value as ExternalOutboxStatus);
}
