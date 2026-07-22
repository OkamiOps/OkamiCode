import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { expect, it, vi } from "vitest";
import type { IpcChannel } from "../../shared/contracts/ipc";
import { createTestDatabase } from "../db/test-support";
import { RuntimeRegistry } from "../runtime/registry";
import { createAppState, type AppState } from "./app-state";
import { registerIpcHandlers } from "./handlers";

vi.mock("electron", () => ({ dialog: {} }));

function harness() {
  const fixture = createTestDatabase();
  const sendTurn = vi.fn(async () => ({
    runId: randomUUID(),
    events: (async function* () {})(),
  }));
  const state = createAppState({
    database: fixture.db,
    runtimes: new RuntimeRegistry(),
    createId: randomUUID,
    clock: () => new Date("2026-07-20T12:00:00.000Z"),
  });
  state.laneService = {
    open: vi.fn(async () => ({
      laneId: fixture.laneId,
      taskId: fixture.taskId,
      harness: "claude",
      runtimeKind: "claude",
      runtimeVersion: "test",
      providerAccountLabel: "Claude Max",
      model: "claude-test",
      routeKind: "native",
      routeReason: "native_requested",
      displayQuotaAccount: "Claude Max",
      permissionMode: null,
      workspacePath: null,
      nativeSessionId: "session-test",
      nativeSessionIdPrefix: "session…",
      delta: { events: [], fromCursorExclusive: 0, toCursorInclusive: 0 },
      status: "ready",
      pendingDeltaEvents: 0,
    })),
    sendTurn,
  } as unknown as AppState["laneService"];

  const handlers = new Map<IpcChannel, Parameters<IpcMain["handle"]>[1]>();
  registerIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel as IpcChannel, handler);
      },
    },
    rendererUrl: "http://127.0.0.1:5173/index.html",
    state,
    clientCapabilities: async () => [],
  });
  const senderFrame = { url: "http://127.0.0.1:5173/kanban" };
  const event = {
    senderFrame,
    sender: { mainFrame: senderFrame, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  return { event, fixture, handlers, sendTurn };
}

it("keeps manual cards local and wakes a delegated lane once per update", async () => {
  const { event, fixture, handlers, sendTurn } = harness();
  const manual = await handlers.get("kanban:create")?.(event, {
    title: "Preparar briefing",
    description: "",
    status: "backlog",
    ownerKind: "human",
    laneId: null,
    activationPolicy: "manual",
  });
  expect(manual).toMatchObject({
    card: { title: "Preparar briefing", taskId: null, ownerKind: "human" },
    wake: { shouldWake: false },
  });
  expect(sendTurn).not.toHaveBeenCalled();

  const delegated = await handlers.get("kanban:create")?.(event, {
    title: "Revisar documentação",
    description: "Validar o PR antes do merge.",
    status: "backlog",
    ownerKind: "lane",
    laneId: fixture.laneId,
    activationPolicy: "status_transition",
  });
  expect(delegated).toMatchObject({
    card: {
      taskId: fixture.taskId,
      laneId: fixture.laneId,
      lastProcessedHash: expect.any(String),
    },
    wake: { shouldWake: true },
  });
  expect(sendTurn).toHaveBeenCalledOnce();

  const cardId = (delegated as { card: { id: string } }).card.id;
  const idempotencyKey = randomUUID();
  await handlers.get("kanban:move")?.(event, {
    cardId,
    status: "in_progress",
    position: 0,
    idempotencyKey,
  });
  await handlers.get("kanban:move")?.(event, {
    cardId,
    status: "in_progress",
    position: 0,
    idempotencyKey,
  });
  expect(sendTurn).toHaveBeenCalledTimes(2);

  const updated = await handlers.get("kanban:update")?.(event, {
    cardId,
    title: "Revisar documentação e riscos",
    description: "Validar o PR, registrar riscos e preparar uma recomendação.",
    idempotencyKey: randomUUID(),
  });
  expect(updated).toMatchObject({
    card: {
      title: "Revisar documentação e riscos",
      description:
        "Validar o PR, registrar riscos e preparar uma recomendação.",
    },
    wake: { shouldWake: false, reason: "no_relevant_change" },
  });
  expect(sendTurn).toHaveBeenCalledTimes(2);

  await expect(
    handlers.get("kanban:delete")?.(event, {
      cardId,
      confirmation: "delete_kanban_card",
    }),
  ).resolves.toEqual({ cardId, deleted: true });
  expect(
    fixture.db.prepare("SELECT 1 FROM kanban_cards WHERE id = ?").get(cardId),
  ).toBeUndefined();
});
