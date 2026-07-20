import { describe, expect, it } from "vitest";
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
});
