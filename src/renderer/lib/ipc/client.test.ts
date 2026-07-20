import { beforeEach, expect, it, vi } from "vitest";
import { emitOkamiEvent, installOkamiMock } from "../../test/okami-mock";
import { type RendererOkamiBridge, workbenchClient } from "./client";
import { subscribeToWorkbenchEvents } from "./events";
import type { IpcChannel } from "../../../shared/contracts/ipc";

const electronMocks = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(async () => undefined),
  on: vi.fn(),
  removeListener: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electronMocks.expose },
  dialog: { showSaveDialog: electronMocks.showSaveDialog },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

type RegisteredHandler = (event: unknown, payload: unknown) => Promise<unknown>;
interface TestAppState {
  database: unknown;
  tasks: unknown;
  lanes: unknown;
  runs: unknown;
  events: unknown;
  approvals: unknown;
  policyEngine: unknown;
  runtimes: unknown;
  laneService: unknown;
  runService: unknown;
  createId: () => string;
  clock: () => Date;
  reportBackgroundError: (error: unknown) => void;
}

const sharedContract = (await vi.importActual(
  "../../../shared/contracts/ipc",
)) as {
  ipcChannels: readonly IpcChannel[];
  eventChannel: string;
};
const { ipcChannels, eventChannel } = sharedContract;

const handlerModule = (await vi.importActual("../../../main/ipc/handlers")) as {
  registerIpcHandlers(options: {
    ipcMain: {
      handle(channel: string, handler: RegisteredHandler): void;
    };
    rendererUrl: string;
    state: TestAppState;
    clientCapabilities?: () => Promise<unknown[]>;
  }): void;
};
const { registerIpcHandlers } = handlerModule;

function ipcHarness(state: TestAppState, clientCapabilities = async () => []) {
  const handlers = new Map<IpcChannel, RegisteredHandler>();
  registerIpcHandlers({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel as IpcChannel, handler);
      },
    },
    rendererUrl: "http://127.0.0.1:5173/index.html",
    state,
    clientCapabilities,
  });
  return handlers;
}

function trustedEvent() {
  const senderFrame = { url: "http://127.0.0.1:5173/workbench" };
  return {
    senderFrame,
    sender: { mainFrame: senderFrame, send: vi.fn() },
  };
}

function stateFixture(overrides: Partial<TestAppState> = {}): TestAppState {
  return {
    database: {
      prepare: vi.fn(() => ({
        get: vi.fn(() => ({ healthy: 1 })),
        all: vi.fn(() => []),
      })),
    },
    tasks: { insert: vi.fn() },
    lanes: { findById: vi.fn() },
    runs: { findById: vi.fn() },
    events: { append: vi.fn() },
    approvals: { findById: vi.fn(), resolve: vi.fn() },
    policyEngine: {},
    runtimes: { lookup: vi.fn() },
    laneService: { list: vi.fn(() => []), open: vi.fn(), sendTurn: vi.fn() },
    runService: {},
    createId: () => "b672d2e8-688b-48ac-a618-3294bfc96a99",
    clock: () => new Date("2026-07-18T12:00:00.000Z"),
    reportBackgroundError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() =>
  installOkamiMock({
    systemDoctor: { database: "ok", runtimes: [], clients: [] },
  }),
);

it("validates responses before returning them", async () => {
  await expect(workbenchClient.systemDoctor()).resolves.toEqual({
    database: "ok",
    runtimes: [],
    clients: [],
  });
  installOkamiMock({
    systemDoctor: { database: 42, runtimes: [], clients: [] },
  });
  await expect(workbenchClient.systemDoctor()).rejects.toThrow(/database/);
});

it("exposes exactly the enumerated command surface", () => {
  expect(ipcChannels).toEqual(ipcChannels);
  expect(ipcChannels).toEqual([
    "system:doctor",
    "models:list",
    "task:create",
    "task:rename",
    "task:delete",
    "workspace:pick",
    "file:pick",
    "fs:list",
    "fs:read",
    "fs:search",
    "terminal:open",
    "terminal:write",
    "terminal:resize",
    "terminal:close",
    "run:list",
    "run:events",
    "lane:setPermissionMode",
    "task:archive",
    "task:fork",
    "conversation:export",
    "audit:export",
    "eco:mcp",
    "eco:skills",
    "eco:memoryList",
    "eco:memoryRead",
    "eco:memoryWrite",
    "eco:settings",
    "eco:agents",
    "task:list",
    "kanban:list",
    "kanban:create",
    "kanban:move",
    "kanban:assign",
    "lane:list",
    "conversation:history",
    "lane:ensure",
    "lane:open",
    "lane:sendTurn",
    "run:cancel",
    "approval:resolve",
    "quickChat:create",
    "quickChat:send",
    "usage:overview",
    "usage:refresh",
    "usage:alertSet",
    "memory:configure",
    "memory:list",
    "memory:search",
    "memory:reindex",
    "inbox:accounts:list",
    "inbox:account:add",
    "inbox:account:remove",
    "inbox:account:sync",
    "inbox:threads:list",
    "inbox:thread:get",
    "inbox:thread:markRead",
  ]);
  expect(Object.keys(window.okami.invoke)).toEqual(ipcChannels);
});

it("provides typed Inbox account and thread commands through the bridge", async () => {
  const accountId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
  const threadId = "4d32d86d-3199-4327-9d0c-e283268ed239";
  const now = "2026-07-21T12:00:00.000Z";
  const account = {
    id: accountId,
    provider: "imap",
    displayName: "Primary",
    address: "me@example.com",
    status: "connected",
    syncCursor: null,
    lastError: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const summary = {
    account,
    configuration: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      mailbox: "INBOX",
      maxInitialMessages: 100,
      maxMessageBytes: 2_097_152,
    },
    hasCredential: true,
  };
  installOkamiMock({
    "inbox:accounts:list": [summary],
    "inbox:account:add": summary,
    "inbox:account:sync": {
      account,
      counts: { inserted: 1, updated: 0, unchanged: 0 },
    },
    "inbox:thread:get": {
      thread: {
        id: threadId,
        accountId,
        externalThreadId: "x",
        subject: "Subject",
        snippet: "",
        participants: [],
        unreadCount: 0,
        lastMessageAt: now,
        labels: [],
        createdAt: now,
        updatedAt: now,
      },
      messages: [],
    },
  });

  await expect(workbenchClient.inboxAccountsList()).resolves.toEqual([summary]);
  await expect(
    workbenchClient.inboxAccountAdd({
      provider: "imap",
      displayName: "Primary",
      address: "me@example.com",
      configuration: { host: "imap.example.com", port: 993, secure: true },
      credential: {
        version: 1,
        kind: "imap_password",
        username: "me@example.com",
        password: "secret",
      },
    }),
  ).resolves.toEqual(summary);
  await expect(
    workbenchClient.inboxAccountSync({ accountId }),
  ).resolves.toMatchObject({ counts: { inserted: 1 } });
  await expect(
    workbenchClient.inboxThreadGet({ threadId }),
  ).resolves.toMatchObject({ thread: { id: threadId } });
});

it("parses events before notifying consumers", () => {
  const event = {
    schemaVersion: 1,
    id: "event-1",
    taskId: "27ee79a7-d3c3-48dd-84c6-cb589a4cb606",
    laneId: "50df72f3-cc11-42d2-87be-c928a9ae2cbf",
    runId: "4d32d86d-3199-4327-9d0c-e283268ed239",
    sequence: 0,
    occurredAt: "2026-07-18T12:00:00.000Z",
    kind: "session_started",
    nativeEventId: null,
    payload: {},
  };
  const received: unknown[] = [];
  const unsubscribe = subscribeToWorkbenchEvents((parsed) =>
    received.push(parsed),
  );

  emitOkamiEvent(event);
  expect(received).toEqual([event]);
  expect(() => emitOkamiEvent({ ...event, schemaVersion: 2 })).toThrow(
    /schemaVersion/,
  );
  expect(received).toEqual([event]);

  unsubscribe();
});

it("exposes a frozen preload facade and removes wrapped event listeners", async () => {
  await vi.importActual("../../../preload/index");
  expect(electronMocks.expose).toHaveBeenCalledOnce();
  const [, okami] = electronMocks.expose.mock.calls[0] as [
    string,
    RendererOkamiBridge,
  ];

  expect(Object.keys(okami).sort()).toEqual([
    "bridgeVersion",
    "invoke",
    "onEvent",
    "onTerminalData",
  ]);
  expect(Object.isFrozen(okami)).toBe(true);
  expect(Object.isFrozen(okami.invoke)).toBe(true);
  expect(Object.keys(okami.invoke)).toEqual(ipcChannels);

  await okami.invoke["lane:list"]({});
  expect(electronMocks.invoke).toHaveBeenCalledWith("lane:list", {});

  const listener = vi.fn();
  const unsubscribe = okami.onEvent(listener);
  const [channel, wrapped] = electronMocks.on.mock.calls[0] as [
    string,
    (_event: unknown, payload: unknown) => void,
  ];
  expect(channel).toBe(eventChannel);
  wrapped({}, { schemaVersion: 1 });
  expect(listener).toHaveBeenCalledWith({ schemaVersion: 1 });
  unsubscribe();
  expect(electronMocks.removeListener).toHaveBeenCalledWith(
    eventChannel,
    wrapped,
  );
});

it("registers every handler and parses requests before touching services", async () => {
  const state = new Proxy(
    {},
    {
      get: () => {
        throw new Error("service touched");
      },
    },
  ) as unknown as TestAppState;
  const handlers = ipcHarness(state);

  expect([...handlers.keys()]).toEqual(ipcChannels);
  for (const channel of ipcChannels) {
    await expect(
      handlers.get(channel)?.(trustedEvent(), { unexpected: true }),
    ).rejects.not.toThrow("service touched");
  }
});

it("rejects an untrusted renderer before command dispatch", async () => {
  const handlers = ipcHarness(stateFixture());
  const event = trustedEvent();
  event.senderFrame.url = "https://evil.example/workbench";

  await expect(handlers.get("task:list")?.(event, {})).rejects.toThrow(
    "Untrusted renderer origin",
  );
});

it("runs doctor and task handlers through real state dependencies", async () => {
  const inserted: unknown[] = [];
  const database = {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn(() => ({ healthy: 1 })),
      all: vi.fn(() =>
        sql.includes("FROM tasks")
          ? [
              {
                id: "b672d2e8-688b-48ac-a618-3294bfc96a99",
                kind: "workbench",
                title: "Workbench task",
                objective: "Ship the bridge",
                status: "active",
                created_at: "2026-07-18T12:00:00.000Z",
                updated_at: "2026-07-18T12:00:00.000Z",
              },
            ]
          : [],
      ),
    })),
  };
  const adapter = {
    detect: vi.fn(async () => ({
      available: true,
      protocolSupported: true,
      version: "1.2.3",
    })),
  };
  const state = stateFixture({
    database,
    tasks: { insert: (task: unknown) => inserted.push(task) },
    runtimes: {
      lookup: vi.fn(() => adapter),
    },
  });
  const handlers = ipcHarness(state);

  await expect(
    handlers.get("system:doctor")?.(trustedEvent(), {}),
  ).resolves.toEqual({
    database: "ok",
    runtimes: [
      {
        runtime: "claude",
        status: "ready",
        version: "1.2.3",
        detail: null,
      },
      {
        runtime: "codex",
        status: "ready",
        version: "1.2.3",
        detail: null,
      },
    ],
    clients: [],
  });
  await expect(
    handlers.get("task:create")?.(trustedEvent(), {
      title: "Workbench task",
      objective: "Ship the bridge",
    }),
  ).resolves.toMatchObject({ title: "Workbench task", status: "active" });
  expect(inserted).toHaveLength(1);
  await expect(
    handlers.get("task:list")?.(trustedEvent(), {}),
  ).resolves.toEqual([
    expect.objectContaining({ title: "Workbench task", status: "active" }),
  ]);
});

it("opens lanes, sends turns, and forwards only sanitized canonical events", async () => {
  const canonicalEvent = {
    schemaVersion: 1 as const,
    id: "event-2",
    taskId: "27ee79a7-d3c3-48dd-84c6-cb589a4cb606",
    laneId: "50df72f3-cc11-42d2-87be-c928a9ae2cbf",
    runId: "4d32d86d-3199-4327-9d0c-e283268ed239",
    sequence: 1,
    occurredAt: "2026-07-18T12:00:00.000Z",
    kind: "message_delta" as const,
    nativeEventId: null,
    payload: {
      cwd: "/Users/marcos/secret",
      provider_token: "provider-secret-value",
      input_tokens: 12,
    },
  };
  const opened = {
    laneId: canonicalEvent.laneId,
    taskId: canonicalEvent.taskId,
    nativeSessionId: "native-session-1",
    nativeSessionIdPrefix: "native-s…",
    runtimeVersion: "1.2.3",
    temperature: "hot" as const,
    delta: null,
    pendingDeltaEvents: 0,
    harness: "native" as const,
    runtimeKind: "codex" as const,
    providerAccountLabel: "ChatGPT",
    model: "gpt-5.6",
    routeKind: "native" as const,
    routeReason: "native_requested",
    displayQuotaAccount: "ChatGPT subscription",
    permissionMode: null,
    workspacePath: "/workspace/okami",
    status: "ready" as const,
  };
  const listed = {
    ...opened,
    nativeSessionIdPrefix: "native-s…",
  };
  delete (listed as Partial<typeof opened>).nativeSessionId;
  delete (listed as Partial<typeof opened>).delta;
  const append = vi.fn();
  const state = stateFixture({
    events: { append },
    laneService: {
      list: vi.fn(() => [listed]),
      open: vi.fn(async () => opened),
      sendTurn: vi.fn(async () => ({
        runId: canonicalEvent.runId,
        events: (async function* () {
          yield canonicalEvent;
        })(),
      })),
    },
  });
  const handlers = ipcHarness(state);
  const event = trustedEvent();

  await expect(
    handlers.get("lane:list")?.(event, { taskId: canonicalEvent.taskId }),
  ).resolves.toEqual([listed]);
  await expect(
    handlers.get("lane:open")?.(event, { laneId: opened.laneId }),
  ).resolves.toMatchObject({
    nativeSessionIdPrefix: "native-s…",
    providerAccountLabel: "ChatGPT",
    model: "gpt-5.6",
    workspacePath: "/workspace/okami",
  });
  await expect(
    handlers.get("lane:sendTurn")?.(event, {
      laneId: opened.laneId,
      input: "Continue",
    }),
  ).resolves.toEqual({
    runId: canonicalEvent.runId,
    laneId: opened.laneId,
    status: "running",
  });
  await vi.waitFor(() => expect(append).toHaveBeenCalledWith(canonicalEvent));
  expect(event.sender.send).toHaveBeenCalledWith(eventChannel, {
    ...canonicalEvent,
    payload: {
      // Paths are the user's own working material and stay visible; only
      // credentials are redacted for the renderer.
      cwd: "/Users/marcos/secret",
      provider_token: "[redacted]",
      input_tokens: 12,
    },
  });
});

it("validates lane list projections in the renderer client", async () => {
  const lane = {
    laneId: "50df72f3-cc11-42d2-87be-c928a9ae2cbf",
    taskId: "27ee79a7-d3c3-48dd-84c6-cb589a4cb606",
    harness: "claude",
    runtimeKind: "claude",
    runtimeVersion: "0.144.5",
    providerAccountLabel: "ChatGPT",
    model: "gpt-5.6",
    routeKind: "bridged",
    routeReason: "subscription_bridge",
    displayQuotaAccount: "ChatGPT Plus",
    permissionMode: null,
    workspacePath: "/workspace/okami",
    nativeSessionIdPrefix: "thread-1…",
    status: "ready",
    temperature: "stale",
    pendingDeltaEvents: 2,
  };
  installOkamiMock({ "lane:list": [lane] });

  await expect(workbenchClient.laneList({})).resolves.toEqual([lane]);
  installOkamiMock({ "lane:list": [{ ...lane, pendingDeltaEvents: -1 }] });
  await expect(workbenchClient.laneList({})).rejects.toThrow(
    /pendingDeltaEvents/,
  );
});

it("cancels runs and resolves approvals through their owning runtime", async () => {
  const runId = "4d32d86d-3199-4327-9d0c-e283268ed239";
  const laneId = "50df72f3-cc11-42d2-87be-c928a9ae2cbf";
  const approvalId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
  const adapter = { cancel: vi.fn(), respondToApproval: vi.fn() };
  const resolved = {
    id: approvalId,
    runId,
    laneId,
    status: "allowed_once" as const,
    resolvedAt: "2026-07-18T12:00:00.000Z",
  };
  const state = stateFixture({
    runs: {
      findById: vi.fn(() => ({ id: runId, laneId })),
    },
    lanes: {
      findById: vi.fn(() => ({ id: laneId, runtimeKind: "codex" })),
    },
    approvals: {
      findById: vi.fn(() => ({ id: approvalId, runId, laneId })),
      resolve: vi.fn(() => resolved),
    },
    runtimes: {
      lookup: vi.fn(() => adapter),
    },
  });
  const handlers = ipcHarness(state);

  await expect(
    handlers.get("run:cancel")?.(trustedEvent(), { runId }),
  ).resolves.toEqual({ runId, cancelled: true });
  expect(adapter.cancel).toHaveBeenCalledWith(runId);
  await expect(
    handlers.get("approval:resolve")?.(trustedEvent(), {
      approvalId,
      decision: "allow_once",
    }),
  ).resolves.toEqual(resolved);
  expect(adapter.respondToApproval).toHaveBeenCalledWith({
    runId,
    approvalId,
    decision: "allow_once",
  });
});

it("returns honest unavailable usage data when collectors have no database", async () => {
  const handlers = ipcHarness(stateFixture());
  const expected = {
    activity: [],
    alerts: [],
    context: {
      collectedAt: "2026-07-18T12:00:00.000Z",
      freshness: "unavailable",
      laneId: null,
      remainingTokens: null,
      source: {
        adapterVersion: "event-v1",
        kind: "unavailable",
        method: "native session usage events",
      },
      usedPercent: null,
    },
    generatedAt: "2026-07-18T12:00:00.000Z",
    subscriptions: [],
  };

  await expect(
    handlers.get("usage:overview")?.(trustedEvent(), {}),
  ).resolves.toEqual(expected);
  await expect(
    handlers.get("usage:refresh")?.(trustedEvent(), {}),
  ).resolves.toEqual(expected);
  await expect(
    handlers.get("usage:alertSet")?.(trustedEvent(), {
      provider: "chatgpt",
      accountRef: "primary",
      remainingPercent: 20,
      enabled: true,
    }),
  ).resolves.toEqual({
    provider: "chatgpt",
    accountRef: "primary",
    remainingPercent: 20,
    enabled: true,
  });
});
