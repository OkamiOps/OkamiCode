import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcChannel } from "../../shared/contracts/ipc";
import { createTestDatabase, type TestDatabase } from "../db/test-support";
import { RuntimeRegistry } from "../runtime/registry";
import { createAppState, type AppState } from "./app-state";
import { registerIpcHandlers } from "./handlers";

vi.mock("electron", () => ({ dialog: {} }));

const openFixtures: TestDatabase[] = [];

afterEach(() => {
  for (const fixture of openFixtures.splice(0)) fixture.db.close();
});

function harness() {
  const fixture = createTestDatabase();
  openFixtures.push(fixture);
  const state = createAppState({
    database: fixture.db,
    runtimes: new RuntimeRegistry(),
    createId: randomUUID,
    clock: () => new Date("2026-07-21T12:00:00.000Z"),
  });
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
  const senderFrame = { url: "http://127.0.0.1:5173/workbench" };
  const event = {
    senderFrame,
    sender: { mainFrame: senderFrame, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  return { event, fixture, handlers, state };
}

describe("lane IPC safety", () => {
  it("removes a newly created lane when its runtime cannot be opened", async () => {
    const { event, fixture, handlers, state } = harness();
    state.laneService.open = vi.fn(async () => {
      throw new Error("Cursor CLI is not authenticated");
    }) as AppState["laneService"]["open"];

    await expect(
      handlers.get("lane:ensure")?.(event, {
        taskId: fixture.taskId,
        runtimeKind: "cursor",
        model: "default",
      }),
    ).rejects.toThrow("Cursor CLI is not authenticated");
    expect(
      fixture.lanes
        .list(fixture.taskId)
        .filter((lane) => lane.runtimeKind === "cursor"),
    ).toEqual([]);
  });

  it("rejects unsupported Cursor permission modes before persisting them", async () => {
    const { event, fixture, handlers } = harness();
    const lane = fixture.lanes.findById(fixture.laneId);
    if (!lane) throw new Error("Missing lane fixture");
    fixture.lanes.update(
      {
        ...lane,
        runtimeKind: "cursor",
        providerKind: "cursor",
        model: "default",
        updatedAt: "2026-07-21T12:00:00.000Z",
      },
      lane.updatedAt,
    );

    await expect(
      handlers.get("lane:setPermissionMode")?.(event, {
        laneId: fixture.laneId,
        mode: "bypassPermissions",
      }),
    ).rejects.toThrow(
      "Permission mode bypassPermissions is not supported by cursor",
    );
    expect(fixture.lanes.findById(fixture.laneId)?.permissionMode).toBeNull();
  });
});
