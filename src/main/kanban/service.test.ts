import { describe, expect, it } from "vitest";
import { LaneRepository } from "../db/repositories/lanes";
import { createTestDatabase } from "../db/test-support";
import { KanbanCardRepository, KanbanCardService } from "./service";

function createService() {
  const fx = createTestDatabase();
  let id = 0;
  let tick = 0;
  const service = new KanbanCardService({
    cards: new KanbanCardRepository(fx.db),
    lanes: new LaneRepository(fx.db),
    createId: () => `card-${++id}`,
    clock: () => `2026-07-21T00:00:0${++tick}.000Z`,
  });
  return { ...fx, service };
}

describe("KanbanCardService", () => {
  it("creates manual cards without a task by default", () => {
    const fx = createService();

    const card = fx.service.create({
      title: "Review the proposal",
      description: "",
    });

    expect(card).toMatchObject({
      title: "Review the proposal",
      status: "backlog",
      ownerKind: "human",
      laneId: null,
      activationPolicy: "manual",
      position: 0,
      taskId: null,
    });
    expect(card.stateHash).toBe(card.lastProcessedHash);
    expect(card.lastProcessedCursor).toBe(1);
  });

  it("adopts a valid lane task when assigning an unscoped card", () => {
    const fx = createService();
    const card = fx.service.create({
      title: "Draft the proposal",
      description: "",
    });

    const result = fx.service.assign({
      cardId: card.id,
      ownerKind: "lane",
      laneId: fx.laneId,
      activationPolicy: "relevant_change",
      idempotencyKey: "assign-lane-1",
    });

    expect(result.card).toMatchObject({
      taskId: fx.taskId,
      ownerKind: "lane",
      laneId: fx.laneId,
      activationPolicy: "relevant_change",
    });
    expect(result.wake.shouldWake).toBe(true);
    expect(fx.service.list().find((item) => item.id === card.id)?.taskId).toBe(
      fx.taskId,
    );
  });

  it("wakes an assigned lane when a status transition has a new semantic state", () => {
    const fx = createService();
    const card = fx.service.create({
      taskId: fx.taskId,
      title: "Implement Kanban",
      description: "",
      ownerKind: "lane",
      laneId: fx.laneId,
      activationPolicy: "status_transition",
    });

    const result = fx.service.move({
      cardId: card.id,
      status: "in_progress",
      idempotencyKey: "move-1",
    });

    expect(result.wake).toEqual({
      shouldWake: true,
      reason: "status_transition",
      delta: {
        stateChanged: true,
        statusChanged: true,
        ownerChanged: false,
        laneChanged: false,
      },
    });
    expect(result.card.lastProcessedHash).not.toBe(result.card.stateHash);
    expect(result.card.lastProcessedCursor).toBe(1);

    const retry = fx.service.move({
      cardId: card.id,
      status: "in_progress",
      idempotencyKey: "move-1",
    });
    expect(retry.wake.shouldWake).toBe(true);

    const acknowledged = fx.service.acknowledgeWake(card.id, "move-1");
    expect(acknowledged.lastProcessedHash).toBe(acknowledged.stateHash);
    expect(acknowledged.lastProcessedCursor).toBe(2);
    const completedDuplicate = fx.service.move({
      cardId: card.id,
      status: "in_progress",
      idempotencyKey: "move-1",
    });
    expect(completedDuplicate.wake.reason).toBe("idempotent");
  });

  it("does not wake a lane for a reorder or a duplicate mutation", () => {
    const fx = createService();
    const card = fx.service.create({
      taskId: fx.taskId,
      title: "Reorder safely",
      description: "",
      ownerKind: "lane",
      laneId: fx.laneId,
      activationPolicy: "relevant_change",
    });

    const reordered = fx.service.move({
      cardId: card.id,
      status: "backlog",
      position: 4,
      idempotencyKey: "reorder-1",
    });
    const duplicate = fx.service.move({
      cardId: card.id,
      status: "backlog",
      position: 4,
      idempotencyKey: "reorder-1",
    });

    expect(reordered.wake.shouldWake).toBe(false);
    expect(reordered.wake.reason).toBe("no_relevant_change");
    expect(duplicate.wake.shouldWake).toBe(false);
    expect(duplicate.wake.reason).toBe("idempotent");
    expect(fx.service.listEvents(card.id)).toHaveLength(2);
  });

  it("does not wake when the selected lane is no longer available", () => {
    const fx = createService();
    const card = fx.service.create({
      taskId: fx.taskId,
      title: "Keep state even if lane disappeared",
      description: "",
      ownerKind: "lane",
      laneId: "missing-lane",
      activationPolicy: "relevant_change",
    });

    const result = fx.service.move({
      cardId: card.id,
      status: "in_progress",
      idempotencyKey: "missing-lane-1",
    });

    expect(result.wake.shouldWake).toBe(false);
    expect(result.wake.reason).toBe("lane_missing");
  });

  it("keeps one event for an idempotency key", () => {
    const fx = createService();
    const card = fx.service.create({
      taskId: fx.taskId,
      title: "Keep one event",
      description: "",
      activationPolicy: "manual",
    });

    fx.service.assign({
      cardId: card.id,
      ownerKind: "human",
      laneId: null,
      idempotencyKey: "assign-1",
    });
    fx.service.assign({
      cardId: card.id,
      ownerKind: "human",
      laneId: null,
      idempotencyKey: "assign-1",
    });

    expect(fx.service.listEvents(card.id)).toHaveLength(2);
  });
});
