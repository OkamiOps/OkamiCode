import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../db/test-support";
import {
  ExternalOutboxConflictError,
  ExternalOutboxService,
} from "../outbox/service";
import { InboxService } from "./service";
import {
  InboxReplyDraftNoIncomingMessageError,
  InboxReplyDraftService,
  InboxReplyDraftThreadNotFoundError,
} from "./reply-draft-service";

const now = "2026-07-21T12:00:00.000Z";

function harness() {
  const fixture = createTestDatabase();
  const inbox = new InboxService(fixture.db);
  const account = inbox.addAccount({
    provider: "imap",
    displayName: "Primary",
    address: "me@example.com",
  });
  inbox.applySyncBatch({
    accountId: account.id,
    previousCursor: null,
    nextCursor: "cursor-1",
    threads: [
      {
        externalThreadId: "proposal-1",
        subject: "Re: Landing page proposal",
        snippet: "Please send a proposal.",
        participants: ["client@example.com"],
        unreadCount: 1,
        lastMessageAt: now,
        labels: ["inbox"],
      },
    ],
    messages: [
      {
        externalMessageId: "incoming-older",
        threadExternalId: "proposal-1",
        direction: "incoming",
        sender: "old-client@example.com",
        recipients: ["me@example.com"],
        body: "Older message",
        bodyFormat: "text",
        sentAt: "2026-07-21T10:00:00.000Z",
        receivedAt: "2026-07-21T10:00:00.000Z",
        attachments: [],
      },
      {
        externalMessageId: "outgoing-1",
        threadExternalId: "proposal-1",
        direction: "outgoing",
        sender: "me@example.com",
        recipients: ["client@example.com"],
        body: "Previous answer",
        bodyFormat: "text",
        sentAt: "2026-07-21T10:30:00.000Z",
        receivedAt: null,
        attachments: [],
      },
      {
        externalMessageId: "incoming-newest",
        threadExternalId: "proposal-1",
        direction: "incoming",
        sender: "client@example.com",
        recipients: ["me@example.com"],
        body: "Newest message",
        bodyFormat: "text",
        sentAt: null,
        receivedAt: "2026-07-21T11:00:00.000Z",
        attachments: [],
      },
    ],
    syncedAt: now,
  });
  const threadId = inbox.listThreads().threads[0].id;
  return {
    fixture,
    inbox,
    threadId,
    service: new InboxReplyDraftService({ db: fixture.db }),
  };
}

describe("InboxReplyDraftService", () => {
  it("derives an approval-pending reply from the latest persisted incoming message", () => {
    const { fixture, service, threadId } = harness();

    const result = service.createReplyDraft({
      threadId,
      body: "  Obrigado, envio a proposta amanhã.  ",
      idempotencyKey: randomUUID(),
    });

    expect(result).toMatchObject({
      sourceThreadId: threadId,
      to: ["client@example.com"],
      subject: "Re: Landing page proposal",
      body: "Obrigado, envio a proposta amanhã.",
      status: "approval_pending",
      requiresApproval: true,
      safeRetry: false,
      attempts: 0,
    });
    expect(
      fixture.db
        .prepare(
          "SELECT status, approved_at, attempts, payload_json FROM external_outbox WHERE id = ?",
        )
        .get(result.id),
    ).toEqual({
      status: "approval_pending",
      approved_at: null,
      attempts: 0,
      payload_json: JSON.stringify({
        body: "Obrigado, envio a proposta amanhã.",
        externalThreadId: "proposal-1",
        inReplyTo: "incoming-newest",
        subject: "Re: Landing page proposal",
        threadId,
        to: ["client@example.com"],
      }),
    });
  });

  it("uses a bounded fallback subject without duplicating Re", () => {
    const { fixture, service, threadId } = harness();
    fixture.db
      .prepare("UPDATE inbox_threads SET subject = ? WHERE id = ?")
      .run(" re: RE: ", threadId);

    const fallback = service.createReplyDraft({
      threadId,
      body: "Reply",
      idempotencyKey: randomUUID(),
    });
    expect(fallback.subject).toBe("Re: (sem assunto)");

    fixture.db
      .prepare("UPDATE inbox_threads SET subject = ? WHERE id = ?")
      .run("s".repeat(2_100), threadId);
    const bounded = service.createReplyDraft({
      threadId,
      body: "Another reply",
      idempotencyKey: randomUUID(),
    });
    expect(bounded.subject).toHaveLength(2_000);
    expect(bounded.subject.startsWith("Re: ")).toBe(true);
  });

  it("normalizes and preserves a long persisted sender accepted by the inbox contract", () => {
    const { fixture, service, threadId } = harness();
    const sender = `client+${"x".repeat(1_900)}@example.com`;
    fixture.db
      .prepare(
        "UPDATE inbox_messages SET sender = ? WHERE thread_id = ? AND external_message_id = ?",
      )
      .run(`  ${sender}  `, threadId, "incoming-newest");

    const result = service.createReplyDraft({
      threadId,
      body: "Reply",
      idempotencyKey: randomUUID(),
    });

    expect(result.to).toEqual([sender]);
  });

  it("fails closed for an unavailable thread or a thread without an incoming message", () => {
    const { fixture, inbox, service, threadId } = harness();

    expect(() =>
      service.createReplyDraft({
        threadId: randomUUID(),
        body: "Reply",
        idempotencyKey: randomUUID(),
      }),
    ).toThrow(InboxReplyDraftThreadNotFoundError);

    fixture.db
      .prepare("DELETE FROM inbox_messages WHERE thread_id = ?")
      .run(threadId);
    expect(() =>
      service.createReplyDraft({
        threadId,
        body: "Reply",
        idempotencyKey: randomUUID(),
      }),
    ).toThrow(InboxReplyDraftNoIncomingMessageError);
    expect(inbox.getThread(threadId).messages).toEqual([]);
  });

  it("validates a trimmed reply body before writing an outbox record", () => {
    const { fixture, service, threadId } = harness();
    for (const body of ["   ", "x".repeat(20_001)]) {
      expect(() =>
        service.createReplyDraft({
          threadId,
          body,
          idempotencyKey: randomUUID(),
        }),
      ).toThrow();
    }
    expect(
      fixture.db.prepare("SELECT count(*) FROM external_outbox").pluck().get(),
    ).toBe(0);
  });

  it("replays an identical draft and rejects a reused key with a different body", () => {
    const { fixture, inbox, service, threadId } = harness();
    const idempotencyKey = randomUUID();
    const first = service.createReplyDraft({
      threadId,
      body: "  Reply  ",
      idempotencyKey,
    });
    const accountId = inbox.getThread(threadId).thread.accountId;
    fixture.db
      .prepare(
        `INSERT INTO inbox_messages
         (id, account_id, thread_id, external_message_id, direction, sender,
          recipients_json, body, body_format, sent_at, received_at,
          attachments_json, untrusted_content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        accountId,
        threadId,
        "incoming-after-draft",
        "incoming",
        "new-client@example.com",
        JSON.stringify(["me@example.com"]),
        "A new incoming message arrived after the draft.",
        "text",
        null,
        "2026-07-21T12:30:00.000Z",
        "[]",
        1,
        "2026-07-21T12:30:00.000Z",
        "2026-07-21T12:30:00.000Z",
      );
    const replay = service.createReplyDraft({
      threadId,
      body: "Reply",
      idempotencyKey,
    });

    expect(replay).toEqual(first);
    expect(
      fixture.db.prepare("SELECT count(*) FROM external_outbox").pluck().get(),
    ).toBe(1);
    expect(() =>
      service.createReplyDraft({
        threadId,
        body: "Different reply",
        idempotencyKey,
      }),
    ).toThrow(ExternalOutboxConflictError);
  });

  it("recovers the same draft when a process stops before requesting approval", () => {
    const { fixture, inbox, service, threadId } = harness();
    const detail = inbox.getThread(threadId);
    const idempotencyKey = randomUUID();
    const draft = new ExternalOutboxService(fixture.db).createDraft({
      connectorAccountId: detail.thread.accountId,
      kind: "email.reply",
      payload: {
        threadId,
        externalThreadId: detail.thread.externalThreadId,
        inReplyTo: "incoming-newest",
        to: ["client@example.com"],
        subject: "Re: Landing page proposal",
        body: "Reply",
      },
      idempotencyKey,
      requiresApproval: true,
      safeRetry: false,
    });
    expect(draft.status).toBe("draft");

    const recovered = service.createReplyDraft({
      threadId,
      body: "Reply",
      idempotencyKey,
    });

    expect(recovered).toMatchObject({
      id: draft.id,
      status: "approval_pending",
      attempts: 0,
    });
    expect(
      fixture.db
        .prepare("SELECT status, approved_at FROM external_outbox WHERE id = ?")
        .get(draft.id),
    ).toEqual({ status: "approval_pending", approved_at: null });
  });

  it("fails closed when the existing action has already been approved", () => {
    const { fixture, service, threadId } = harness();
    const idempotencyKey = randomUUID();
    const pending = service.createReplyDraft({
      threadId,
      body: "Reply",
      idempotencyKey,
    });
    fixture.db
      .prepare("UPDATE external_outbox SET approved_at = ? WHERE id = ?")
      .run(now, pending.id);

    expect(() =>
      service.createReplyDraft({
        threadId,
        body: "Reply",
        idempotencyKey,
      }),
    ).toThrow("Unexpected reply draft state: approval_pending");
  });
});
