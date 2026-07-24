import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcChannel } from "../../shared/contracts/ipc";
import type { RuntimeKind } from "../../shared/contracts/lane";
import type { TaskId } from "../../shared/ids";
import { createTestDatabase, type TestDatabase } from "../db/test-support";
import type { RuntimeTransport } from "../runtime/manifest";
import { RuntimeRegistry } from "../runtime/registry";
import { ChatCompletionsTransportAdapter } from "../runtime/sdk/chat-completions-transport";
import { ProviderRuntimeAdapter } from "../runtime/sdk/provider-runtime";
import { ResponsesTransportAdapter } from "../runtime/sdk/responses-transport";
import { encodeTransportSessionBinding } from "../runtime/sdk/session-binding";
import { createAppState } from "./app-state";
import { registerIpcHandlers } from "./handlers";

vi.mock("electron", () => ({ dialog: {} }));

const openFixtures: TestDatabase[] = [];

afterEach(() => {
  for (const fixture of openFixtures.splice(0)) fixture.db.close();
});

describe("Token Plan lane forwarding", () => {
  it("preserves MiMo rehydration and cursors after a real failed stream and reopen", async () => {
    const fixture = preparedFixture("mimo", "mimo-responses");
    const fetchRequest = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return sseResponse([
          {
            type: "response.failed",
            response: { error: { message: "provider stream failed" } },
          },
        ]);
      },
    );
    const first = ipcHarness(
      fixture,
      providerRuntime(
        "mimo",
        "mimo-responses",
        new ResponsesTransportAdapter({
          kind: "mimo",
          transportId: "mimo-responses",
          baseUrl: "https://example.invalid/v1",
          credentialReference: "MIMO_TOKEN",
          credential: { get: async () => "okami-owned-token" },
          taskIdForRun: async () => fixture.taskId as TaskId,
          fetch: fetchRequest,
        }),
      ),
    );

    const result = await first.handlers.get("lane:sendTurn")?.(first.event, {
      laneId: fixture.laneId,
      input: "continue o trabalho",
    });

    await vi.waitFor(() =>
      expect(fixture.runs.findById(result?.runId as string)?.status).toBe(
        "failed",
      ),
    );
    expect(fixture.lanes.findById(fixture.laneId)?.lastEventCursor).toBe(0);
    expect(
      fixture.lanes.findNativeSessionBinding(fixture.laneId),
    ).toMatchObject({ rehydrationRequired: true });

    const reopened = createAppState({
      database: fixture.db,
      runtimes: registryWith(
        providerRuntime(
          "mimo",
          "mimo-responses",
          responsesAdapter(fixture, "mimo", "mimo-responses"),
        ),
      ),
    });
    await expect(
      reopened.laneService.open(fixture.laneId),
    ).resolves.toMatchObject({
      temperature: "cold",
      rehydrationRequired: true,
    });
    expect(
      JSON.parse(String(fetchRequest.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      input: expect.stringContaining("tool_call_completed"),
    });
  });

  it("preserves MiniMax rehydration and cursors after a real cancellation and reopen", async () => {
    const fixture = preparedFixture("minimax", "minimax-api");
    let release!: () => void;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          release = () => {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          };
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
    const fetchRequest = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input;
        void init;
        return response;
      },
    );
    const adapter = new ChatCompletionsTransportAdapter({
      kind: "minimax",
      transportId: "minimax-api",
      baseUrl: "https://example.invalid/v1",
      credentialReference: "MINIMAX_API_KEY",
      credential: { get: async () => "okami-owned-token" },
      taskIdForRun: async () => fixture.taskId as TaskId,
      fetch: fetchRequest,
    });
    const runtime = providerRuntime("minimax", "minimax-api", adapter);
    const first = ipcHarness(fixture, runtime);

    const result = await first.handlers.get("lane:sendTurn")?.(first.event, {
      laneId: fixture.laneId,
      input: "continue o trabalho",
    });
    await runtime.cancel(result?.runId as never);
    release();

    await vi.waitFor(() =>
      expect(fixture.runs.findById(result?.runId as string)?.status).toBe(
        "cancelled",
      ),
    );
    expect(fixture.lanes.findById(fixture.laneId)?.lastEventCursor).toBe(0);
    expect(
      fixture.lanes.findNativeSessionBinding(fixture.laneId),
    ).toMatchObject({ rehydrationRequired: true });
    expect(
      JSON.parse(String(fetchRequest.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      messages: [
        {
          role: "user",
          content: expect.stringContaining("tool_call_completed"),
        },
      ],
    });

    const reopened = createAppState({
      database: fixture.db,
      runtimes: registryWith(
        providerRuntime("minimax", "minimax-api", chatAdapter(fixture)),
      ),
    });
    await expect(
      reopened.laneService.open(fixture.laneId),
    ).resolves.toMatchObject({
      temperature: "cold",
      rehydrationRequired: true,
    });
  });
});

function preparedFixture(
  runtime: "mimo" | "minimax",
  transportId: string,
): TestDatabase {
  const fixture = createTestDatabase();
  openFixtures.push(fixture);
  const lane = fixture.lanes.findById(fixture.laneId);
  if (!lane) throw new Error("Missing lane fixture");
  fixture.lanes.update(
    {
      ...lane,
      runtimeKind: runtime,
      providerKind: runtime,
      model: runtime === "mimo" ? "mimo-v2" : "MiniMax-M2.7",
      updatedAt: new Date(Date.parse(lane.updatedAt) + 1).toISOString(),
    },
    lane.updatedAt,
  );
  fixture.lanes.bindNativeSession({
    laneId: fixture.laneId,
    nativeSessionId: encodeTransportSessionBinding(
      transportId,
      "provider-session",
    ),
    runtimeVersion: "token-plan-v1",
    boundAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
  });
  fixture.events.append(
    fixture.event({
      id: randomUUID(),
      sequence: 1,
      kind: "tool_call_completed",
      payload: {
        runtime,
        callId: "handoff",
        status: "completed",
        output: "handoff-event",
      },
    }),
  );
  return fixture;
}

function ipcHarness(fixture: TestDatabase, runtime: ProviderRuntimeAdapter) {
  const state = createAppState({
    database: fixture.db,
    runtimes: registryWith(runtime),
    createId: randomUUID,
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
  return { event, handlers };
}

function registryWith(runtime: ProviderRuntimeAdapter): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registry.register(runtime);
  return registry;
}

function providerRuntime(
  kind: "mimo" | "minimax",
  transportId: string,
  adapter: ResponsesTransportAdapter | ChatCompletionsTransportAdapter,
): ProviderRuntimeAdapter {
  const descriptor: RuntimeTransport = {
    id: transportId,
    kind: "api",
    authentication: "okami_vault",
    entitlement: "token_plan",
    priority: 1,
    optional: false,
    protocolVersion: "test",
    executable: null,
    legacySessionOwner: true,
  };
  return new ProviderRuntimeAdapter(kind, [{ descriptor, adapter }]);
}

function responsesAdapter(
  fixture: TestDatabase,
  kind: RuntimeKind,
  transportId: string,
): ResponsesTransportAdapter {
  return new ResponsesTransportAdapter({
    kind,
    transportId,
    baseUrl: "https://example.invalid/v1",
    credentialReference: "TOKEN",
    credential: { get: async () => "okami-owned-token" },
    taskIdForRun: async () => fixture.taskId as TaskId,
    fetch: vi.fn(async () => sseResponse([])),
  });
}

function chatAdapter(fixture: TestDatabase): ChatCompletionsTransportAdapter {
  return new ChatCompletionsTransportAdapter({
    kind: "minimax",
    transportId: "minimax-api",
    baseUrl: "https://example.invalid/v1",
    credentialReference: "MINIMAX_API_KEY",
    credential: { get: async () => "okami-owned-token" },
    taskIdForRun: async () => fixture.taskId as TaskId,
    fetch: vi.fn(async () => sseResponse([])),
  });
}

function sseResponse(events: unknown[]): Response {
  return new Response(
    `${events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("")}data: [DONE]\n\n`,
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}
