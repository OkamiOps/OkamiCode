import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../../shared/contracts/event";
import type { IpcChannel } from "../../shared/contracts/ipc";
import type { RunId } from "../../shared/ids";
import { createTestDatabase, type TestDatabase } from "../db/test-support";
import type { OpenedLane } from "../orchestration/lane-service";
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

function deferredOpened(fixture: TestDatabase): OpenedLane {
  return {
    laneId: fixture.laneId,
    taskId: fixture.taskId,
    nativeSessionId: null,
    nativeSessionIdPrefix: null,
    bindingState: "deferred",
    runtimeVersion: "deferred-runtime",
    temperature: "cold",
    delta: null,
    pendingDeltaEvents: 0,
    harness: "claude",
    runtimeKind: "claude",
    providerAccountLabel: "Claude Max",
    model: "claude-test",
    routeKind: "direct",
    routeReason: "claude_model",
    displayQuotaAccount: "Claude subscription",
    permissionMode: "manual",
    workspacePath: null,
    status: "ready",
  };
}

function configureDeferredRun(
  state: AppState,
  fixture: TestDatabase,
  events: AsyncIterable<CanonicalEvent>,
  opened = deferredOpened(fixture),
): OpenedLane {
  state.laneService.open = vi.fn(
    async () => opened,
  ) as AppState["laneService"]["open"];
  state.laneService.sendTurn = vi.fn(async () => ({
    runId: fixture.runId as RunId,
    events,
  })) as AppState["laneService"]["sendTurn"];
  state.reportBackgroundError = vi.fn();
  return opened;
}

describe("lane IPC safety", () => {
  it("includes Antigravity in the runtime health projection", async () => {
    const { event, handlers, state } = harness();
    state.runtimes.register({
      kind: "agy",
      detect: async () => ({
        available: true,
        protocolSupported: true,
        version: "1.1.5",
      }),
    } as never);

    const result = await handlers.get("system:doctor")?.(event, {});

    expect(result).toMatchObject({
      runtimes: expect.arrayContaining([
        {
          runtime: "agy",
          status: "ready",
          version: "1.1.5",
          detail: null,
        },
      ]),
    });
  });

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

  it("persists Antigravity lanes with the dedicated subscription provider", async () => {
    const { event, fixture, handlers, state } = harness();
    state.laneService.open = vi.fn(async () =>
      deferredOpened(fixture),
    ) as AppState["laneService"]["open"];

    await handlers.get("lane:ensure")?.(event, {
      taskId: fixture.taskId,
      runtimeKind: "agy",
      model: "default",
    });

    expect(
      fixture.lanes
        .list(fixture.taskId)
        .find((lane) => lane.runtimeKind === "agy"),
    ).toMatchObject({ providerKind: "antigravity", model: "default" });
  });

  it.each([
    ["task", () => randomUUID()],
    ["lane", () => randomUUID()],
    ["run", () => randomUUID()],
  ])(
    "rejects a mismatched %s before persisting the event",
    async (field, id) => {
      const { event, fixture, handlers, state } = harness();
      const mismatch = id();
      async function* events() {
        yield fixture.event({
          kind: "session_started",
          ...(field === "task" ? { taskId: mismatch } : {}),
          ...(field === "lane" ? { laneId: mismatch } : {}),
          ...(field === "run"
            ? { runId: mismatch }
            : { runId: fixture.runId as RunId }),
          payload: { nativeSessionId: "mismatched-session", runtime: "claude" },
        });
      }
      configureDeferredRun(state, fixture, events());

      await handlers.get("lane:sendTurn")?.(event, {
        laneId: fixture.laneId,
        input: "start deferred lane",
      });

      await vi.waitFor(() =>
        expect(state.reportBackgroundError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: "Native session event does not match the active lane run",
          }),
        ),
      );
      expect(
        fixture.lanes.findNativeSessionBinding(fixture.laneId),
      ).toBeUndefined();
      expect(fixture.events.afterCursor(fixture.laneId, 0)).toEqual([]);
    },
  );

  it("rejects a mismatched runtime before persisting the event", async () => {
    const { event, fixture, handlers, state } = harness();
    async function* events() {
      yield fixture.event({
        kind: "session_started",
        runId: fixture.runId as RunId,
        payload: { nativeSessionId: "wrong-runtime", runtime: "codex" },
      });
    }
    configureDeferredRun(state, fixture, events());

    await handlers.get("lane:sendTurn")?.(event, {
      laneId: fixture.laneId,
      input: "start deferred lane",
    });

    await vi.waitFor(() =>
      expect(state.reportBackgroundError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Native session event does not match the active runtime",
        }),
      ),
    );
    expect(
      fixture.lanes.findNativeSessionBinding(fixture.laneId),
    ).toBeUndefined();
    expect(fixture.events.afterCursor(fixture.laneId, 0)).toEqual([]);
  });

  it("forwards an authoritative session event without attempting deferred promotion", async () => {
    const { event, fixture, handlers, state } = harness();
    async function* events() {
      yield fixture.event({
        kind: "session_resumed",
        runId: fixture.runId as RunId,
        payload: { nativeSessionId: "existing-authoritative-session" },
      });
    }
    const opened: OpenedLane = {
      ...deferredOpened(fixture),
      bindingState: "authoritative",
      nativeSessionId: "existing-authoritative-session",
      nativeSessionIdPrefix: "existing…",
    };
    const promote = vi.spyOn(state.laneService, "promoteNativeSession");
    configureDeferredRun(state, fixture, events(), opened);

    await handlers.get("lane:sendTurn")?.(event, {
      laneId: fixture.laneId,
      input: "continue authoritative lane",
    });

    await vi.waitFor(() =>
      expect(fixture.events.afterCursor(fixture.laneId, 0)).toHaveLength(1),
    );
    expect(promote).not.toHaveBeenCalled();
    expect(state.reportBackgroundError).not.toHaveBeenCalled();
  });

  it("persists completed assistant text in the shared task conversation", async () => {
    const { event, fixture, handlers, state } = harness();
    async function* events() {
      yield fixture.event({
        kind: "message_completed",
        runId: fixture.runId as RunId,
        payload: { text: "Resultado que o próximo provider precisa receber" },
      });
    }
    configureDeferredRun(state, fixture, events());

    await handlers.get("lane:sendTurn")?.(event, {
      laneId: fixture.laneId,
      input: "Faça a correção",
    });

    await vi.waitFor(() => {
      const rows = fixture.db
        .prepare(
          `SELECT role, content_json FROM messages ORDER BY sequence ASC`,
        )
        .all() as Array<{ role: string; content_json: string }>;
      expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
      expect(JSON.parse(rows[1]?.content_json ?? "{}")).toMatchObject({
        body: "Resultado que o próximo provider precisa receber",
        laneId: fixture.laneId,
        model: "claude-test",
      });
    });
  });

  it("persists sanitized operational context for sibling providers", async () => {
    const { event, fixture, handlers, state } = harness();
    async function* events() {
      yield fixture.event({
        kind: "tool_call_completed",
        runId: fixture.runId as RunId,
        payload: {
          title: "Editou 2 arquivos",
          status: "completed",
          summary: "Arquivos alterados: src/a.ts, src/b.ts",
          rawOutput: "Authorization: Bearer do-not-share-this-token",
        },
      });
      yield fixture.event({
        kind: "approval_resolved",
        sequence: 2,
        runId: fixture.runId as RunId,
        payload: {
          decision: "allow_once",
          summary: "Aprovação: escrita permitida uma vez",
          authorization: "Bearer do-not-share-this-token",
        },
      });
      yield fixture.event({
        kind: "run_failed",
        sequence: 3,
        runId: fixture.runId as RunId,
        payload: {
          message: "Falha: build terminou com código 1",
          environment: { API_KEY: "do-not-share-this-token" },
        },
      });
    }
    configureDeferredRun(state, fixture, events());

    await handlers.get("lane:sendTurn")?.(event, {
      laneId: fixture.laneId,
      input: "Faça a correção",
    });

    await vi.waitFor(() => {
      const rows = fixture.db
        .prepare(
          `SELECT role, content_json FROM messages ORDER BY sequence ASC`,
        )
        .all() as Array<{ role: string; content_json: string }>;
      expect(rows.map((row) => row.role)).toEqual([
        "user",
        "context",
        "context",
        "context",
      ]);
      const serialized = JSON.stringify(rows);
      expect(serialized).toContain("Arquivos alterados: src/a.ts, src/b.ts");
      expect(serialized).toContain("Aprovação: escrita permitida uma vez");
      expect(serialized).toContain("Falha: build terminou com código 1");
      expect(serialized).not.toContain("do-not-share-this-token");
      expect(serialized).not.toContain("rawOutput");
      expect(serialized).not.toContain("environment");
    });
  });

  it("promotes a matching event and refreshes an equal idempotent binding", async () => {
    const { event, fixture, handlers, state } = harness();
    async function* events() {
      yield fixture.event({
        kind: "session_started",
        runId: fixture.runId as RunId,
        payload: {
          nativeSessionId: "authoritative-session",
          runtime: "claude",
          runtimeVersion: "v1",
        },
      });
      yield fixture.event({
        kind: "session_resumed",
        sequence: 2,
        runId: fixture.runId as RunId,
        payload: {
          nativeSessionId: "authoritative-session",
          runtime: "claude",
          runtimeVersion: "v2",
        },
      });
    }
    const opened = configureDeferredRun(state, fixture, events());

    await handlers.get("lane:sendTurn")?.(event, {
      laneId: fixture.laneId,
      input: "start deferred lane",
    });

    await vi.waitFor(() =>
      expect(fixture.lanes.findNativeSessionBinding(fixture.laneId)).toEqual(
        expect.objectContaining({
          nativeSessionId: "authoritative-session",
          runtimeVersion: "v2",
        }),
      ),
    );
    expect(fixture.events.afterCursor(fixture.laneId, 0)).toHaveLength(2);
    expect(opened).toMatchObject({
      bindingState: "authoritative",
      nativeSessionId: "authoritative-session",
    });
  });

  it("reports a conflicting second id without overwriting the first", async () => {
    const { event, fixture, handlers, state } = harness();
    async function* events() {
      yield fixture.event({
        kind: "session_started",
        runId: fixture.runId as RunId,
        payload: { nativeSessionId: "first-id", runtime: "claude" },
      });
      yield fixture.event({
        kind: "session_resumed",
        sequence: 2,
        runId: fixture.runId as RunId,
        payload: { nativeSessionId: "different-id", runtime: "claude" },
      });
    }
    configureDeferredRun(state, fixture, events());

    await handlers.get("lane:sendTurn")?.(event, {
      laneId: fixture.laneId,
      input: "start deferred lane",
    });

    await vi.waitFor(() =>
      expect(state.reportBackgroundError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Native session binding conflict" }),
      ),
    );
    expect(fixture.lanes.findNativeSessionBinding(fixture.laneId)).toEqual(
      expect.objectContaining({ nativeSessionId: "first-id" }),
    );
    expect(fixture.events.afterCursor(fixture.laneId, 0)).toHaveLength(1);
  });
});
