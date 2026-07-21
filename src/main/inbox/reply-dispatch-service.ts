import type {
  ConnectorCredential,
  ConnectorCredentialVault,
} from "../connectors/credential-vault";
import type { Database } from "../db/connection";
import {
  ExternalOutboxService,
  type ExternalOutboxRecord,
} from "../outbox/service";
import {
  InboxOutgoingSettingsService,
  type OutgoingSettings,
} from "./outgoing-settings-service";
import {
  createSmtpReplyTransport,
  type SmtpReplyMessage,
  type SmtpReplyTransport,
  type SmtpReplyTransportFactory,
} from "./smtp-transport";

export interface ReplyDispatchResult {
  id: string;
  status: "dispatching" | "confirmed" | "uncertain";
  attempts: number;
  approvedAt: string | null;
  lastError: string | null;
}

interface EmailReplyPayload {
  threadId: string;
  externalThreadId: string;
  inReplyTo: string;
  to: [string];
  subject: string;
  body: string;
}

interface ReplyDispatchDependencies {
  db: Database;
  vault: Pick<ConnectorCredentialVault, "get">;
  outgoingSettings?: Pick<InboxOutgoingSettingsService, "get">;
  transportFactory?: SmtpReplyTransportFactory;
}

const PUBLIC_UNAVAILABLE_ERROR = "Reply dispatch is unavailable";
const PUBLIC_UNCERTAIN_ERROR = "Email dispatch outcome is uncertain.";

export class ReplyDispatchService {
  private readonly outbox: ExternalOutboxService;
  private readonly settings: Pick<InboxOutgoingSettingsService, "get">;

  constructor(private readonly dependencies: ReplyDispatchDependencies) {
    this.outbox = new ExternalOutboxService(dependencies.db);
    this.settings =
      dependencies.outgoingSettings ??
      new InboxOutgoingSettingsService({ db: dependencies.db });
  }

  recoverInterruptedDispatches(): number {
    return this.outbox.recoverInterruptedDispatches();
  }

  async approveAndSend(outboxId: string): Promise<ReplyDispatchResult> {
    const initial = this.requireReply(this.outbox.findById(outboxId));
    if (isReplay(initial)) return sanitize(initial);
    this.requirePendingApproval(initial);

    const prepared = await this.preflight(initial);
    const current = this.requireReply(this.outbox.findById(outboxId));
    if (isReplay(current)) return sanitize(current);
    this.requirePendingApproval(current);

    this.outbox.approve(current.id);
    const claim = this.outbox.claimDispatch(current.id);
    if (!claim.acquired) return sanitize(claim.record);

    try {
      const receipt = normalizeReceipt(
        await prepared.transport.send(prepared.message),
      );
      return sanitize(this.outbox.confirm(claim.record.id, receipt));
    } catch {
      return sanitize(
        this.outbox.markUncertain(claim.record.id, PUBLIC_UNCERTAIN_ERROR),
      );
    }
  }

  private async preflight(record: ExternalOutboxRecord): Promise<{
    settings: OutgoingSettings;
    credential: ConnectorCredential;
    message: SmtpReplyMessage;
    transport: SmtpReplyTransport;
  }> {
    let settings: OutgoingSettings | null;
    let credential: ConnectorCredential | null;
    try {
      [settings, credential] = await Promise.all([
        Promise.resolve(this.settings.get(record.connectorAccountId)),
        this.dependencies.vault.get(record.connectorAccountId),
      ]);
    } catch {
      throw new Error(PUBLIC_UNAVAILABLE_ERROR);
    }
    if (!isValidSettings(settings) || !isValidCredential(credential)) {
      throw new Error(PUBLIC_UNAVAILABLE_ERROR);
    }
    const payload = requireEmailReplyPayload(record.payload);
    let transport: SmtpReplyTransport;
    try {
      transport = (
        this.dependencies.transportFactory ?? {
          create: createSmtpReplyTransport,
        }
      ).create({ settings, credential });
    } catch {
      throw new Error(PUBLIC_UNAVAILABLE_ERROR);
    }
    if (!isTransport(transport)) throw new Error(PUBLIC_UNAVAILABLE_ERROR);
    return {
      settings,
      credential,
      message: {
        from: credential.username,
        to: payload.to,
        subject: payload.subject,
        text: payload.body,
        inReplyTo: payload.inReplyTo,
        references: payload.inReplyTo,
      },
      transport,
    };
  }

  private requireReply(
    record: ExternalOutboxRecord | undefined,
  ): ExternalOutboxRecord {
    if (
      !record ||
      record.kind !== "email.reply" ||
      !record.requiresApproval ||
      record.safeRetry
    ) {
      throw new Error(PUBLIC_UNAVAILABLE_ERROR);
    }
    return record;
  }

  private requirePendingApproval(record: ExternalOutboxRecord): void {
    if (record.status !== "approval_pending") {
      throw new Error(PUBLIC_UNAVAILABLE_ERROR);
    }
  }
}

function isReplay(record: ExternalOutboxRecord): boolean {
  return (
    record.status === "confirmed" ||
    record.status === "uncertain" ||
    record.status === "dispatching"
  );
}

function sanitize(record: ExternalOutboxRecord): ReplyDispatchResult {
  if (
    record.status !== "dispatching" &&
    record.status !== "confirmed" &&
    record.status !== "uncertain"
  ) {
    throw new Error(PUBLIC_UNAVAILABLE_ERROR);
  }
  return {
    id: record.id,
    status: record.status,
    attempts: record.attempts,
    approvedAt: record.approvedAt,
    lastError: record.lastError,
  };
}

function requireEmailReplyPayload(value: unknown): EmailReplyPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(PUBLIC_UNAVAILABLE_ERROR);
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
    !expectedKeys.every((key) => Object.hasOwn(payload, key)) ||
    !expectedKeys
      .filter((key) => key !== "to")
      .every((key) => isNonEmptyText(payload[key])) ||
    !Array.isArray(payload.to) ||
    payload.to.length !== 1 ||
    !isNonEmptyText(payload.to[0])
  ) {
    throw new Error(PUBLIC_UNAVAILABLE_ERROR);
  }
  return {
    threadId: payload.threadId as string,
    externalThreadId: payload.externalThreadId as string,
    inReplyTo: payload.inReplyTo as string,
    to: [payload.to[0] as string],
    subject: payload.subject as string,
    body: payload.body as string,
  };
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidSettings(value: unknown): value is OutgoingSettings {
  if (!isPlainRecord(value)) return false;
  return (
    isNonEmptyText(value.host) &&
    value.host.length <= 255 &&
    typeof value.port === "number" &&
    Number.isInteger(value.port) &&
    value.port >= 1 &&
    value.port <= 65_535 &&
    typeof value.secure === "boolean" &&
    isNonEmptyText(value.createdAt) &&
    isNonEmptyText(value.updatedAt)
  );
}

function isValidCredential(value: unknown): value is ConnectorCredential {
  if (
    !isPlainRecord(value) ||
    value.version !== 1 ||
    !isNonEmptyText(value.username)
  ) {
    return false;
  }
  return (
    (value.kind === "imap_password" && isNonEmptyText(value.password)) ||
    (value.kind === "oauth" && isNonEmptyText(value.accessToken))
  );
}

function isTransport(value: unknown): value is SmtpReplyTransport {
  return isPlainRecord(value) && typeof value.send === "function";
}

function normalizeReceipt(value: unknown): {
  messageId: string | null;
  acceptedCount: number;
  rejectedCount: number;
} {
  if (
    !isPlainRecord(value) ||
    (value.messageId !== null && typeof value.messageId !== "string") ||
    !isNonNegativeInteger(value.acceptedCount) ||
    !isNonNegativeInteger(value.rejectedCount)
  ) {
    throw new Error("invalid SMTP receipt");
  }
  return {
    messageId: value.messageId,
    acceptedCount: value.acceptedCount,
    rejectedCount: value.rejectedCount,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value as object) === Object.prototype
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
