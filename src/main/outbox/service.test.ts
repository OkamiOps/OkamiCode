import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/connection";
import { createTestDatabase } from "../db/test-support";
import {
  ExternalOutboxConflictError,
  ExternalOutboxService,
  ExternalOutboxTransitionError,
} from "./service";

function createService() {
  const fx = createTestDatabase();
  return { fx, service: new ExternalOutboxService(fx.db) };
}

function createSharedServices() {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "okami-outbox-")),
    "outbox.db",
  );
  const key = Buffer.alloc(32, 4);
  const firstDb = openDatabase(file, key);
  const secondDb = openDatabase(file, key);
  return {
    first: new ExternalOutboxService(firstDb),
    second: new ExternalOutboxService(secondDb),
    firstDb,
    secondDb,
    close() {
      firstDb.close();
      secondDb.close();
    },
  };
}

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    connectorAccountId: "account-1",
    kind: "email.send",
    payload: { recipient: "maria@example.com", subject: "Oi" },
    idempotencyKey: "email-1",
    requiresApproval: true,
    safeRetry: true,
    ...overrides,
  };
}

describe("ExternalOutboxService", () => {
  it("creates one draft for semantically identical payloads and rejects divergent keys", () => {
    const { service } = createService();
    const created = service.createDraft(draftInput());
    const repeated = service.createDraft(
      draftInput({
        payload: { subject: "Oi", recipient: "maria@example.com" },
      }),
    );

    expect(repeated).toEqual(created);
    expect(() =>
      service.createDraft(
        draftInput({ payload: { recipient: "other@example.com" } }),
      ),
    ).toThrow(ExternalOutboxConflictError);
  });

  it("requires approval when configured while manual dispatch can be claimed from a draft", () => {
    const { service } = createService();
    const approvalRequired = service.createDraft(draftInput());
    const manual = service.createDraft(
      draftInput({ idempotencyKey: "email-2", requiresApproval: false }),
    );

    expect(() => service.claimDispatch(approvalRequired.id)).toThrow(
      ExternalOutboxTransitionError,
    );
    expect(service.requestApproval(approvalRequired.id).status).toBe(
      "approval_pending",
    );
    expect(service.approve(approvalRequired.id).approvedAt).not.toBeNull();
    expect(service.claimDispatch(manual.id)).toMatchObject({
      acquired: true,
      record: { status: "dispatching", attempts: 1 },
    });
  });

  it("does not acquire a duplicate claim or increment its attempts", () => {
    const { service } = createService();
    const draft = service.createDraft(
      draftInput({ idempotencyKey: "email-3", requiresApproval: false }),
    );

    expect(service.claimDispatch(draft.id).acquired).toBe(true);
    const duplicate = service.claimDispatch(draft.id);

    expect(duplicate).toMatchObject({
      acquired: false,
      record: { status: "dispatching", attempts: 1 },
    });
  });

  it("confirms a dispatch idempotently without changing timestamps", () => {
    const { service } = createService();
    const draft = service.createDraft(
      draftInput({ idempotencyKey: "email-4", requiresApproval: false }),
    );
    service.claimDispatch(draft.id);

    const confirmed = service.confirm(draft.id, { messageId: "provider-1" });
    const repeated = service.confirm(draft.id, { messageId: "provider-1" });

    expect(repeated).toEqual(confirmed);
    expect(() =>
      service.confirm(draft.id, { messageId: "provider-2" }),
    ).toThrow(ExternalOutboxTransitionError);
  });

  it("retries only safe retryable failures without incrementing attempts before a new claim", () => {
    const { service } = createService();
    const retryable = service.createDraft(
      draftInput({
        idempotencyKey: "email-5",
        requiresApproval: false,
        safeRetry: true,
      }),
    );
    service.claimDispatch(retryable.id);
    service.failRetryable(retryable.id, "temporary provider outage");

    expect(service.retry(retryable.id)).toMatchObject({
      status: "draft",
      attempts: 1,
    });
    expect(service.claimDispatch(retryable.id)).toMatchObject({
      acquired: true,
      record: { attempts: 2 },
    });

    const unsafe = service.createDraft(
      draftInput({
        idempotencyKey: "email-6",
        requiresApproval: false,
        safeRetry: false,
      }),
    );
    service.claimDispatch(unsafe.id);
    service.failRetryable(unsafe.id, "unsafe duplicate risk");
    expect(() => service.retry(unsafe.id)).toThrow(
      ExternalOutboxTransitionError,
    );
  });

  it("returns interrupted dispatches as uncertain instead of retrying them", () => {
    const { service } = createService();
    const draft = service.createDraft(
      draftInput({ idempotencyKey: "email-7", requiresApproval: false }),
    );
    service.claimDispatch(draft.id);

    expect(service.recoverInterruptedDispatches()).toBe(1);
    expect(service.findById(draft.id)).toMatchObject({ status: "uncertain" });
    expect(() => service.retry(draft.id)).toThrow(
      ExternalOutboxTransitionError,
    );
  });

  it("keeps one idempotent draft when a second SQLite connection repeats the create", () => {
    const shared = createSharedServices();
    try {
      const created = shared.first.createDraft(
        draftInput({
          idempotencyKey: "shared-create",
          requiresApproval: false,
        }),
      );

      expect(
        shared.second.createDraft(
          draftInput({
            idempotencyKey: "shared-create",
            requiresApproval: false,
          }),
        ),
      ).toEqual(created);
      expect(shared.second.list()).toHaveLength(1);
    } finally {
      shared.close();
    }
  });

  it("allows only one SQLite connection to claim a dispatch", () => {
    const shared = createSharedServices();
    try {
      const draft = shared.first.createDraft(
        draftInput({ idempotencyKey: "shared-claim", requiresApproval: false }),
      );

      expect(shared.first.claimDispatch(draft.id).acquired).toBe(true);
      expect(shared.second.claimDispatch(draft.id)).toMatchObject({
        acquired: false,
        record: { status: "dispatching", attempts: 1 },
      });
    } finally {
      shared.close();
    }
  });

  it("does not move a dispatching action back to approval pending", () => {
    const shared = createSharedServices();
    try {
      const draft = shared.first.createDraft(
        draftInput({ idempotencyKey: "shared-approval-request" }),
      );
      shared.firstDb.exec(`
        CREATE TRIGGER outbox_approval_request_winner
        BEFORE UPDATE OF status ON external_outbox
        WHEN OLD.status = 'draft' AND NEW.status = 'approval_pending'
        BEGIN
          UPDATE external_outbox
          SET status = 'dispatching', approved_at = '2026-07-21T00:00:00.000Z',
              attempts = 1
          WHERE id = OLD.id;
          SELECT RAISE(IGNORE);
        END;
      `);

      expect(() => shared.second.requestApproval(draft.id)).toThrow(
        ExternalOutboxTransitionError,
      );
      expect(shared.first.findById(draft.id)).toMatchObject({
        status: "dispatching",
        attempts: 1,
      });
    } finally {
      shared.close();
    }
  });

  it("preserves the first approval timestamp when approval races", () => {
    const shared = createSharedServices();
    try {
      const draft = shared.first.createDraft(
        draftInput({ idempotencyKey: "shared-approve" }),
      );
      shared.first.requestApproval(draft.id);
      shared.firstDb.exec(`
        CREATE TRIGGER outbox_approval_winner
        BEFORE UPDATE OF approved_at ON external_outbox
        WHEN OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL
        BEGIN
          UPDATE external_outbox
          SET approved_at = '2026-07-21T00:00:00.000Z',
              updated_at = '2026-07-21T00:00:00.000Z'
          WHERE id = OLD.id;
          SELECT RAISE(IGNORE);
        END;
      `);

      const first = shared.second.approve(draft.id);
      const repeated = shared.first.approve(draft.id);

      expect(first).toEqual(repeated);
      expect(first.approvedAt).toBe("2026-07-21T00:00:00.000Z");
      expect(first.updatedAt).toBe("2026-07-21T00:00:00.000Z");
    } finally {
      shared.close();
    }
  });

  it("does not overwrite a terminal result when another connection wins the dispatch transition", () => {
    const shared = createSharedServices();
    try {
      const draft = shared.first.createDraft(
        draftInput({
          idempotencyKey: "shared-terminal",
          requiresApproval: false,
        }),
      );
      shared.first.claimDispatch(draft.id);
      shared.firstDb.exec(`
        CREATE TRIGGER outbox_terminal_winner
        BEFORE UPDATE OF status ON external_outbox
        WHEN OLD.status = 'dispatching' AND NEW.status = 'failed_terminal'
        BEGIN
          UPDATE external_outbox
          SET status = 'confirmed', provider_receipt_json = '{"messageId":"winner"}'
          WHERE id = OLD.id;
          SELECT RAISE(IGNORE);
        END;
      `);

      expect(() => shared.second.failTerminal(draft.id, "too late")).toThrow(
        ExternalOutboxTransitionError,
      );
      expect(shared.first.findById(draft.id)).toMatchObject({
        status: "confirmed",
        providerReceipt: { messageId: "winner" },
      });
    } finally {
      shared.close();
    }
  });
});
