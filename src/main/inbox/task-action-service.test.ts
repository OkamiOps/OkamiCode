import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KanbanCardRepository } from "../kanban/service";
import { createTestDatabase } from "../db/test-support";
import { InboxService } from "./service";
import {
  InboxTaskActionConflictError,
  InboxTaskActionService,
  InboxTaskActionThreadNotFoundError,
} from "./task-action-service";

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
        subject: "Landing page proposal",
        snippet: "Please send a proposal.",
        participants: ["client@example.com"],
        unreadCount: 1,
        lastMessageAt: now,
        labels: ["inbox"],
      },
    ],
    messages: [
      {
        externalMessageId: "message-1",
        threadExternalId: "proposal-1",
        direction: "incoming",
        sender: "client@example.com",
        recipients: ["me@example.com"],
        body: "<strong>Prepare a landing page proposal.</strong>",
        bodyFormat: "html",
        sentAt: now,
        receivedAt: now,
        attachments: [],
      },
    ],
    syncedAt: now,
  });
  const threadId = inbox.listThreads().threads[0].id;
  const service = new InboxTaskActionService({
    db: fixture.db,
    createId: randomUUID,
    clock: () => now,
  });
  return { fixture, inbox, service, threadId };
}

describe("InboxTaskActionService", () => {
  it("creates a manual human card from a locally persisted thread", () => {
    const { fixture, service, threadId } = harness();

    const result = service.createKanbanTask({
      threadId,
      mode: "manual",
      laneId: null,
      idempotencyKey: randomUUID(),
    });

    expect(result).toMatchObject({
      sourceThreadId: threadId,
      executionStarted: false,
      card: {
        title: "Landing page proposal",
        taskId: null,
        ownerKind: "human",
        laneId: null,
        activationPolicy: "manual",
      },
    });
    expect(result.card.description).toContain("Conteúdo externo não confiável");
    expect(result.card.description).toContain(
      "<strong>Prepare a landing page proposal.</strong>",
    );
    expect(
      fixture.db
        .prepare("SELECT thread_id FROM inbox_thread_actions WHERE id = ?")
        .pluck()
        .get(result.actionId),
    ).toBe(threadId);
  });

  it("creates a delegated card for an existing lane without starting execution", () => {
    const { fixture, service, threadId } = harness();

    const result = service.createKanbanTask({
      threadId,
      mode: "delegate",
      laneId: fixture.laneId,
      title: "Review the proposal request",
      idempotencyKey: randomUUID(),
    });

    expect(result).toMatchObject({
      executionStarted: false,
      card: {
        taskId: fixture.taskId,
        ownerKind: "lane",
        laneId: fixture.laneId,
        activationPolicy: "status_transition",
      },
    });
    expect(
      new KanbanCardRepository(fixture.db).listEvents(result.card.id),
    ).toHaveLength(1);
  });

  it("fails closed when the delegated lane or source thread is unavailable", () => {
    const { service, threadId } = harness();

    expect(() =>
      service.createKanbanTask({
        threadId,
        mode: "delegate",
        laneId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    ).toThrow("Lane");
    expect(() =>
      service.createKanbanTask({
        threadId: randomUUID(),
        mode: "manual",
        laneId: null,
        idempotencyKey: randomUUID(),
      }),
    ).toThrow(InboxTaskActionThreadNotFoundError);
  });

  it("returns the same action and card for an identical idempotent request", () => {
    const { fixture, service, threadId } = harness();
    const idempotencyKey = randomUUID();
    const request = {
      threadId,
      mode: "manual" as const,
      laneId: null,
      title: "  Prepare proposal  ",
      idempotencyKey,
    };

    const first = service.createKanbanTask(request);
    const second = service.createKanbanTask({
      ...request,
      title: "Prepare proposal",
    });

    expect(second).toEqual(first);
    expect(
      fixture.db
        .prepare("SELECT count(*) FROM inbox_thread_actions")
        .pluck()
        .get(),
    ).toBe(1);
    expect(new KanbanCardRepository(fixture.db).list()).toHaveLength(1);
  });

  it("rejects idempotency-key reuse with different parameters", () => {
    const { service, threadId } = harness();
    const idempotencyKey = randomUUID();
    service.createKanbanTask({
      threadId,
      mode: "manual",
      laneId: null,
      idempotencyKey,
    });

    expect(() =>
      service.createKanbanTask({
        threadId,
        mode: "manual",
        laneId: null,
        title: "Different title",
        idempotencyKey,
      }),
    ).toThrow(InboxTaskActionConflictError);
  });

  it("limits untrusted external descriptions to 8,000 characters", () => {
    const { fixture, inbox, service, threadId } = harness();
    inbox.applySyncBatch({
      accountId: inbox.getThread(threadId).thread.accountId,
      previousCursor: "cursor-1",
      nextCursor: "cursor-2",
      threads: [
        {
          externalThreadId: "proposal-1",
          subject: "Landing page proposal",
          snippet: "Please send a proposal.",
          participants: ["client@example.com"],
          unreadCount: 1,
          lastMessageAt: now,
          labels: ["inbox"],
        },
      ],
      messages: [
        {
          externalMessageId: "message-1",
          threadExternalId: "proposal-1",
          direction: "incoming",
          sender: "client@example.com",
          recipients: ["me@example.com"],
          body: "x".repeat(20_000),
          bodyFormat: "html",
          sentAt: now,
          receivedAt: now,
          attachments: [],
        },
      ],
      syncedAt: "2026-07-21T12:05:00.000Z",
    });

    const result = service.createKanbanTask({
      threadId,
      mode: "manual",
      laneId: null,
      idempotencyKey: randomUUID(),
    });

    expect(result.card.description.length).toBeLessThanOrEqual(8_000);
    expect(
      fixture.db.prepare("SELECT count(*) FROM kanban_cards").pluck().get(),
    ).toBe(1);
  });

  it("limits a source subject used as the fallback title to 240 characters", () => {
    const { fixture, service, threadId } = harness();
    fixture.db
      .prepare("UPDATE inbox_threads SET subject = ? WHERE id = ?")
      .run("s".repeat(2_000), threadId);

    const result = service.createKanbanTask({
      threadId,
      mode: "manual",
      laneId: null,
      idempotencyKey: randomUUID(),
    });

    expect(result.card.title).toHaveLength(240);
  });
});
