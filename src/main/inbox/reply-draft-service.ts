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

export interface CreateInboxThreadReplyDraftInput {
  threadId: string;
  body: string;
  idempotencyKey: string;
}

export interface InboxThreadReplyAction {
  id: string;
  sourceThreadId: string;
  connectorAccountId: string;
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

interface EmailReplyPayload {
  threadId: string;
  externalThreadId: string;
  inReplyTo: string;
  to: [string];
  subject: string;
  body: string;
}

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
  private readonly inbox: InboxService;
  private readonly outbox: ExternalOutboxService;

  constructor({ db }: { db: Database }) {
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
    return responseFromRecord(pending, payload);
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
    return responseFromRecord(this.outbox.requestApproval(record.id), payload);
  }

  listReplyActions(threadId: string): InboxThreadReplyAction[] {
    return this.outbox
      .list()
      .flatMap((record) => {
        const payload = emailReplyPayload(record.payload);
        if (
          record.kind !== "email.reply" ||
          !payload ||
          payload.threadId !== threadId ||
          !isPublicReplyAction(record, payload)
        ) {
          return [];
        }
        return [responseFromAction(record, payload)];
      })
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      );
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

function replySubject(detail: InboxThreadDetail): string {
  let subject = detail.thread.subject.trim();
  while (/^re\s*:\s*/iu.test(subject)) {
    subject = subject.replace(/^re\s*:\s*/iu, "");
  }
  const value = subject ? `Re: ${subject}` : "Re: (sem assunto)";
  return value.slice(0, 2_000);
}

function emailReplyPayload(value: unknown): EmailReplyPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const expectedKeys = [
    "threadId",
    "externalThreadId",
    "inReplyTo",
    "to",
    "subject",
    "body",
  ];
  if (
    Object.keys(payload).length !== expectedKeys.length ||
    !expectedKeys.every((key) => key in payload) ||
    !expectedKeys
      .filter((key) => key !== "to")
      .every((key) => typeof payload[key] === "string") ||
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
  };
}

function responseFromRecord(
  record: ExternalOutboxRecord,
  payload: EmailReplyPayload,
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
  const action = responseFromAction(record, payload);
  return {
    id: action.id,
    sourceThreadId: action.sourceThreadId,
    connectorAccountId: action.connectorAccountId,
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
  payload: EmailReplyPayload,
): InboxThreadReplyAction {
  return {
    id: record.id,
    sourceThreadId: payload.threadId,
    connectorAccountId: record.connectorAccountId,
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
  payload: EmailReplyPayload,
): boolean {
  return (
    isUuid(record.id) &&
    isUuid(record.connectorAccountId) &&
    isUuid(payload.threadId) &&
    isBoundedText(payload.externalThreadId, 2_000) &&
    isBoundedText(payload.inReplyTo, 2_000) &&
    payload.to.length === 1 &&
    isBoundedText(payload.to[0], 2_000) &&
    isBoundedText(payload.subject, 2_000) &&
    isBoundedText(payload.body, 20_000) &&
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
