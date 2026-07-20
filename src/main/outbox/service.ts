import { randomUUID } from "node:crypto";
import type { Database } from "../db/connection";

export type ExternalOutboxStatus =
  | "draft"
  | "approval_pending"
  | "dispatching"
  | "confirmed"
  | "uncertain"
  | "failed_retryable"
  | "failed_terminal";

export interface ExternalOutboxRecord {
  id: string;
  connectorAccountId: string;
  kind: string;
  payload: unknown;
  idempotencyKey: string;
  status: ExternalOutboxStatus;
  requiresApproval: boolean;
  approvedAt: string | null;
  safeRetry: boolean;
  attempts: number;
  providerReceipt: unknown | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExternalOutboxDraft {
  connectorAccountId: string;
  kind: string;
  payload: unknown;
  idempotencyKey: string;
  requiresApproval: boolean;
  safeRetry: boolean;
}

export interface DispatchClaim {
  acquired: boolean;
  record: ExternalOutboxRecord;
}

interface ExternalOutboxRow {
  id: string;
  connector_account_id: string;
  kind: string;
  payload_json: string;
  idempotency_key: string;
  status: ExternalOutboxStatus;
  requires_approval: number;
  approved_at: string | null;
  safe_retry: number;
  attempts: number;
  provider_receipt_json: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class ExternalOutboxConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(
      `External outbox idempotency key ${idempotencyKey} conflicts with a different action`,
    );
    this.name = "ExternalOutboxConflictError";
  }
}

export class ExternalOutboxNotFoundError extends Error {
  constructor(id: string) {
    super(`External outbox action ${id} was not found`);
    this.name = "ExternalOutboxNotFoundError";
  }
}

export class ExternalOutboxTransitionError extends Error {
  constructor(id: string, operation: string, status: ExternalOutboxStatus) {
    super(`External outbox action ${id} cannot ${operation} from ${status}`);
    this.name = "ExternalOutboxTransitionError";
  }
}

export class ExternalOutboxService {
  constructor(private readonly db: Database) {}

  createDraft(input: CreateExternalOutboxDraft): ExternalOutboxRecord {
    const payloadJson = canonicalJson(input.payload);
    const now = new Date().toISOString();
    const record: ExternalOutboxRecord = {
      id: randomUUID(),
      connectorAccountId: input.connectorAccountId,
      kind: input.kind,
      payload: JSON.parse(payloadJson),
      idempotencyKey: input.idempotencyKey,
      status: "draft",
      requiresApproval: input.requiresApproval,
      approvedAt: null,
      safeRetry: input.safeRetry,
      attempts: 0,
      providerReceipt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    const inserted = this.db
      .prepare(
        `INSERT INTO external_outbox
         (id, connector_account_id, kind, payload_json, idempotency_key, status,
          requires_approval, approved_at, safe_retry, attempts,
          provider_receipt_json, last_error, created_at, updated_at)
         VALUES (@id, @connectorAccountId, @kind, @payloadJson, @idempotencyKey,
                 @status, @requiresApproval, @approvedAt, @safeRetry, @attempts,
                 @providerReceiptJson, @lastError, @createdAt, @updatedAt)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run({
        ...record,
        payloadJson,
        requiresApproval: boolToInteger(record.requiresApproval),
        safeRetry: boolToInteger(record.safeRetry),
        providerReceiptJson: null,
      });
    if (inserted.changes === 1) return record;

    const existing = this.findByIdempotencyKey(input.idempotencyKey);
    if (existing && sameDraft(existing, input, payloadJson)) return existing;
    throw new ExternalOutboxConflictError(input.idempotencyKey);
  }

  requestApproval(id: string): ExternalOutboxRecord {
    const requested = this.db
      .prepare(
        `UPDATE external_outbox
         SET status = 'approval_pending', updated_at = ?
         WHERE id = ? AND status = 'draft' AND requires_approval = 1`,
      )
      .run(new Date().toISOString(), id);
    if (requested.changes === 1) {
      return this.requireById(id);
    }

    const record = this.requireById(id);
    if (record.status === "approval_pending") return record;
    throw new ExternalOutboxTransitionError(
      id,
      "request approval",
      record.status,
    );
  }

  approve(id: string): ExternalOutboxRecord {
    const now = new Date().toISOString();
    const approved = this.db
      .prepare(
        `UPDATE external_outbox
         SET approved_at = @now, updated_at = @now
         WHERE id = @id
           AND status = 'approval_pending'
           AND approved_at IS NULL`,
      )
      .run({ id, now });
    if (approved.changes === 1) {
      return this.requireById(id);
    }

    const record = this.requireById(id);
    if (record.status === "approval_pending" && record.approvedAt !== null) {
      return record;
    }
    throw new ExternalOutboxTransitionError(id, "approve", record.status);
  }

  claimDispatch(id: string): DispatchClaim {
    return this.db.transaction(() => {
      const claimed = this.db
        .prepare(
          `UPDATE external_outbox
           SET status = 'dispatching', attempts = attempts + 1, updated_at = ?
           WHERE id = ?
             AND (
               (status = 'draft' AND requires_approval = 0)
               OR (status = 'approval_pending' AND approved_at IS NOT NULL)
             )`,
        )
        .run(new Date().toISOString(), id);
      if (claimed.changes === 1) {
        return { acquired: true, record: this.requireById(id) };
      }

      const record = this.requireById(id);
      if (record.status === "dispatching") return { acquired: false, record };
      throw new ExternalOutboxTransitionError(
        id,
        "claim dispatch",
        record.status,
      );
    })();
  }

  confirm(id: string, providerReceipt: unknown | null): ExternalOutboxRecord {
    return this.settle(id, "confirm", "confirmed", providerReceipt, null);
  }

  markUncertain(
    id: string,
    lastError: string | null = null,
  ): ExternalOutboxRecord {
    return this.settle(id, "mark uncertain", "uncertain", undefined, lastError);
  }

  failRetryable(id: string, lastError: string): ExternalOutboxRecord {
    return this.settle(
      id,
      "fail retryable",
      "failed_retryable",
      undefined,
      lastError,
    );
  }

  failTerminal(id: string, lastError: string): ExternalOutboxRecord {
    return this.settle(
      id,
      "fail terminal",
      "failed_terminal",
      undefined,
      lastError,
    );
  }

  retry(id: string): ExternalOutboxRecord {
    return this.db.transaction(() => {
      const record = this.requireById(id);
      if (record.status !== "failed_retryable" || !record.safeRetry) {
        throw new ExternalOutboxTransitionError(id, "retry", record.status);
      }
      return this.update(id, {
        status: record.requiresApproval ? "approval_pending" : "draft",
      });
    })();
  }

  recoverInterruptedDispatches(): number {
    return this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE external_outbox
           SET status = 'uncertain', updated_at = ?
           WHERE status = 'dispatching'`,
        )
        .run(new Date().toISOString());
      return result.changes;
    })();
  }

  findById(id: string): ExternalOutboxRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM external_outbox WHERE id = ?")
      .get(id) as ExternalOutboxRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  list(): ExternalOutboxRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM external_outbox ORDER BY created_at ASC, id ASC")
      .all() as ExternalOutboxRow[];
    return rows.map(rowToRecord);
  }

  private settle(
    id: string,
    operation: string,
    status: Extract<
      ExternalOutboxStatus,
      "confirmed" | "uncertain" | "failed_retryable" | "failed_terminal"
    >,
    providerReceipt: unknown | null | undefined,
    lastError: string | null,
  ): ExternalOutboxRecord {
    const transitioned = this.db
      .prepare(
        `UPDATE external_outbox
         SET status = @status,
             provider_receipt_json = CASE
               WHEN @setProviderReceipt = 1 THEN @providerReceiptJson
               ELSE provider_receipt_json
             END,
             last_error = @lastError,
             updated_at = @updatedAt
         WHERE id = @id AND status = 'dispatching'`,
      )
      .run({
        id,
        status,
        setProviderReceipt: providerReceipt === undefined ? 0 : 1,
        providerReceiptJson:
          providerReceipt === undefined || providerReceipt === null
            ? null
            : canonicalJson(providerReceipt),
        lastError,
        updatedAt: new Date().toISOString(),
      });
    if (transitioned.changes === 1) return this.requireById(id);

    const record = this.requireById(id);
    const receiptMatches =
      providerReceipt === undefined ||
      canonicalJson(record.providerReceipt) === canonicalJson(providerReceipt);
    if (
      record.status === status &&
      receiptMatches &&
      record.lastError === lastError
    ) {
      return record;
    }
    throw new ExternalOutboxTransitionError(id, operation, record.status);
  }

  private requireById(id: string): ExternalOutboxRecord {
    const record = this.findById(id);
    if (!record) throw new ExternalOutboxNotFoundError(id);
    return record;
  }

  private findByIdempotencyKey(
    idempotencyKey: string,
  ): ExternalOutboxRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM external_outbox WHERE idempotency_key = ?")
      .get(idempotencyKey) as ExternalOutboxRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  private update(
    id: string,
    changes: Partial<
      Pick<
        ExternalOutboxRecord,
        "status" | "approvedAt" | "attempts" | "providerReceipt" | "lastError"
      >
    >,
  ): ExternalOutboxRecord {
    const current = this.requireById(id);
    const next: ExternalOutboxRecord = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE external_outbox
         SET status = @status, approved_at = @approvedAt, attempts = @attempts,
             provider_receipt_json = @providerReceiptJson, last_error = @lastError,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        ...next,
        providerReceiptJson:
          next.providerReceipt === null
            ? null
            : canonicalJson(next.providerReceipt),
      });
    return next;
  }
}

function sameDraft(
  record: ExternalOutboxRecord,
  input: CreateExternalOutboxDraft,
  payloadJson: string,
): boolean {
  return (
    record.connectorAccountId === input.connectorAccountId &&
    record.kind === input.kind &&
    canonicalJson(record.payload) === payloadJson &&
    record.requiresApproval === input.requiresApproval &&
    record.safeRetry === input.safeRetry
  );
}

function rowToRecord(row: ExternalOutboxRow): ExternalOutboxRecord {
  return {
    id: row.id,
    connectorAccountId: row.connector_account_id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    idempotencyKey: row.idempotency_key,
    status: row.status,
    requiresApproval: row.requires_approval === 1,
    approvedAt: row.approved_at,
    safeRetry: row.safe_retry === 1,
    attempts: row.attempts,
    providerReceipt:
      row.provider_receipt_json === null
        ? null
        : JSON.parse(row.provider_receipt_json),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function boolToInteger(value: boolean): number {
  return value ? 1 : 0;
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
    if (!Number.isFinite(value))
      throw new TypeError("Outbox JSON must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, canonicalize(object[key])]),
    );
  }
  throw new TypeError("Outbox values must be JSON-serializable");
}
