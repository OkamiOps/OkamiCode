import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { IpcChannel } from "../../shared/contracts/ipc";
import { createTestDatabase } from "../db/test-support";
import { RuntimeRegistry } from "../runtime/registry";
import { createAppState } from "./app-state";
import { registerIpcHandlers } from "./handlers";

const electronMocks = vi.hoisted(() => ({ showSaveDialog: vi.fn() }));

vi.mock("electron", () => ({
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
}));

it("exports a leased and redacted audit log through the main process", async () => {
  const fixture = createTestDatabase();
  const outputPath = join(tmpdir(), `okami-audit-${randomUUID()}.jsonl`);
  fixture.audit.record({
    id: randomUUID(),
    taskId: fixture.taskId,
    laneId: fixture.laneId,
    runId: fixture.runId,
    actor: "runtime",
    action: "tool_finished",
    decision: "allow",
    capability: "terminal.exec",
    resource: { authorization: "Bearer never-export-this" },
    metadata: { token: "sk-never-export-this" },
    occurredAt: "2026-07-18T11:59:00.000Z",
  });
  electronMocks.showSaveDialog.mockResolvedValueOnce({
    canceled: false,
    filePath: outputPath,
  });

  const handlers = new Map<IpcChannel, Parameters<IpcMain["handle"]>[1]>();
  const state = createAppState({
    database: fixture.db,
    runtimes: new RuntimeRegistry(),
    createId: randomUUID,
    clock: () => new Date("2026-07-18T12:00:00.000Z"),
  });
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

  await expect(
    handlers.get("audit:export")?.(
      { senderFrame, sender: { mainFrame: senderFrame } } as IpcMainInvokeEvent,
      { taskId: fixture.taskId, laneId: fixture.laneId },
    ),
  ).resolves.toEqual({ path: outputPath, entryCount: 2 });

  const contents = readFileSync(outputPath, "utf8");
  expect(contents).toContain('"capability":"audit.export"');
  expect(contents).toContain('"decision":"allow"');
  expect(contents).not.toContain("never-export-this");
  expect(contents).not.toContain(outputPath);
  expect(
    fixture.db
      .prepare("SELECT budget_json FROM capability_leases LIMIT 1")
      .get(),
  ).toEqual({ budget_json: '{"maxUses":1,"used":1}' });
});
