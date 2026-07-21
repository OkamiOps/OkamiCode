import { randomUUID } from "node:crypto";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { expect, it, vi } from "vitest";
import { ipcChannels, type IpcChannel } from "../../shared/contracts/ipc";
import { createTestDatabase } from "../db/test-support";
import { RuntimeRegistry } from "../runtime/registry";
import { createAppState } from "./app-state";
import { registerIpcHandlers } from "./handlers";

vi.mock("electron", () => ({ dialog: {} }));

const sourceId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
const eventId = "4d32d86d-3199-4327-9d0c-e283268ed239";
const now = "2026-07-21T12:00:00.000Z";
const source = {
  id: sourceId,
  kind: "local" as const,
  displayName: "Pessoal",
  color: "#0EA5E9",
  timezone: "America/Sao_Paulo",
  status: "active" as const,
  syncCursor: null,
  lastError: null,
  lastSyncedAt: null,
  createdAt: now,
  updatedAt: now,
};
const timedEvent = {
  id: eventId,
  sourceId,
  externalId: eventId,
  title: "Planejamento",
  description: null,
  location: null,
  organizer: null,
  joinUrl: null,
  sourceUrl: null,
  etag: null,
  providerUpdatedAt: null,
  attendees: [],
  status: "confirmed" as const,
  allDay: false as const,
  timezone: "America/Sao_Paulo",
  startsAt: "2026-07-21T15:00:00.000Z",
  endsAt: "2026-07-21T16:00:00.000Z",
  startDate: null,
  endDate: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
};

function harness(
  rendererUrl = "http://127.0.0.1:5173/index.html",
  senderUrl = "http://127.0.0.1:5173/calendar",
) {
  const fixture = createTestDatabase();
  const state = createAppState({
    database: fixture.db,
    runtimes: new RuntimeRegistry(),
    createId: randomUUID,
    clock: () => new Date(now),
  });
  const calendarService = {
    listSources: vi.fn(() => [source]),
    createLocalSource: vi.fn(() => source),
    createLinkedSource: vi.fn(async () => ({
      ...source,
      kind: "caldav" as const,
    })),
    listEvents: vi.fn(() => [timedEvent]),
    createLocalEvent: vi.fn(() => timedEvent),
    updateLocalEvent: vi.fn(() => timedEvent),
    deleteLocalEvent: vi.fn(),
  };
  const handlers = new Map<IpcChannel, Parameters<IpcMain["handle"]>[1]>();
  registerIpcHandlers({
    ipcMain: {
      handle(channel: string, handler: Parameters<IpcMain["handle"]>[1]) {
        handlers.set(channel as IpcChannel, handler);
      },
    },
    rendererUrl,
    state,
    clientCapabilities: async () => [],
    calendarService,
  } as never);
  const senderFrame = { url: senderUrl };
  const event = {
    senderFrame,
    sender: { mainFrame: senderFrame, send: vi.fn() },
  } as unknown as IpcMainInvokeEvent;
  return { calendarService, handlers, event };
}

it("keeps the packaged file origin trusted across hash-routed Calendar navigation", async () => {
  const rendererUrl = "file:///Applications/Okami/out/renderer/index.html";
  const { calendarService, handlers, event } = harness(
    rendererUrl,
    `${rendererUrl}#/calendar`,
  );

  await expect(
    handlers.get("calendar:sources:list" as IpcChannel)?.(event, {}),
  ).resolves.toEqual([source]);
  expect(calendarService.listSources).toHaveBeenCalledOnce();
});

it("routes all seven strict Calendar commands once with public data only", async () => {
  const { calendarService, handlers, event } = harness();

  await expect(
    handlers.get("calendar:sources:list" as IpcChannel)?.(event, {}),
  ).resolves.toEqual([source]);
  await expect(
    handlers.get("calendar:source:createLocal" as IpcChannel)?.(event, {
      displayName: "Pessoal",
      color: "#0EA5E9",
      timezone: "America/Sao_Paulo",
    }),
  ).resolves.toEqual(source);
  await expect(
    handlers.get("calendar:source:createLinked" as IpcChannel)?.(event, {
      accountId: sourceId,
      protocol: "caldav",
      calendarUrl: "https://calendar.example/caldav/marcos",
      displayName: "Trabalho",
      color: "#FF7A1A",
      timezone: "UTC",
    }),
  ).resolves.toMatchObject({ kind: "caldav" });
  await expect(
    handlers.get("calendar:events:list" as IpcChannel)?.(event, {
      sourceIds: [sourceId],
      startsAt: "2026-07-21T00:00:00.000Z",
      endsAt: "2026-07-22T00:00:00.000Z",
    }),
  ).resolves.toEqual([timedEvent]);
  await expect(
    handlers.get("calendar:event:createLocal" as IpcChannel)?.(event, {
      sourceId,
      title: "Planejamento",
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
    }),
  ).resolves.toEqual(timedEvent);
  await expect(
    handlers.get("calendar:event:updateLocal" as IpcChannel)?.(event, {
      eventId,
      sourceId,
      title: "Planejamento revisado",
    }),
  ).resolves.toEqual(timedEvent);
  await expect(
    handlers.get("calendar:event:deleteLocal" as IpcChannel)?.(event, {
      eventId,
      sourceId,
    }),
  ).resolves.toEqual({ eventId, deleted: true });

  expect(calendarService.listSources).toHaveBeenCalledOnce();
  expect(calendarService.createLocalSource).toHaveBeenCalledOnce();
  expect(calendarService.createLinkedSource).toHaveBeenCalledOnce();
  expect(calendarService.listEvents).toHaveBeenCalledOnce();
  expect(calendarService.createLocalEvent).toHaveBeenCalledOnce();
  expect(calendarService.updateLocalEvent).toHaveBeenCalledOnce();
  expect(calendarService.deleteLocalEvent).toHaveBeenCalledWith(
    eventId,
    sourceId,
  );
  expect(
    ipcChannels.filter((channel) => channel.includes("calendar:")),
  ).toEqual([
    "calendar:sources:list",
    "calendar:source:createLocal",
    "calendar:source:createLinked",
    "calendar:events:list",
    "calendar:event:createLocal",
    "calendar:event:updateLocal",
    "calendar:event:deleteLocal",
  ]);
});

it("rejects malformed, secret-shaped and invalid service data before it leaks", async () => {
  const { calendarService, handlers, event } = harness();
  const create = handlers.get("calendar:event:createLocal" as IpcChannel);
  const list = handlers.get("calendar:sources:list" as IpcChannel);

  await expect(
    create?.(event, {
      sourceId,
      title: "Planejamento",
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
      token: "never-send-this",
    }),
  ).rejects.toThrow();
  await expect(
    handlers.get("calendar:source:createLocal" as IpcChannel)?.(event, {
      displayName: "Pessoal",
      color: "#0EA5E9",
      timezone: "America/Sao_Paulo",
      authenticatedUrl: "https://calendar.example/?token=never-send-this",
    }),
  ).rejects.toThrow();
  await expect(
    handlers.get("calendar:events:list" as IpcChannel)?.(event, {
      startsAt: "2026-07-21T00:00:00.000Z",
    }),
  ).rejects.toThrow();
  await expect(
    create?.(event, {
      sourceId,
      title: "Planejamento",
      timezone: "America/Sao_Paulo",
      allDay: true,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
    }),
  ).rejects.toThrow();
  expect(calendarService.createLocalEvent).not.toHaveBeenCalled();
  expect(calendarService.createLocalSource).not.toHaveBeenCalled();
  expect(calendarService.listEvents).not.toHaveBeenCalled();

  calendarService.listSources.mockReturnValueOnce([
    { ...source, password: "no" } as unknown as typeof source,
  ]);
  await expect(list?.(event, {})).rejects.toThrow();
  expect(calendarService.listSources).toHaveBeenCalledOnce();
});

it("rejects an untrusted Calendar request before it touches the service", async () => {
  const { calendarService, handlers } = harness();
  const untrusted = {
    senderFrame: { url: "https://evil.example/calendar" },
    sender: {
      mainFrame: { url: "https://evil.example/calendar" },
      send: vi.fn(),
    },
  } as unknown as IpcMainInvokeEvent;

  await expect(
    handlers.get("calendar:sources:list" as IpcChannel)?.(untrusted, {
      token: "still-not-parsed",
    }),
  ).rejects.toThrow("Untrusted renderer origin");
  expect(calendarService.listSources).not.toHaveBeenCalled();
});

it("rejects unsafe Calendar URLs before dispatch and after service output", async () => {
  const { calendarService, handlers, event } = harness();
  const create = handlers.get("calendar:event:createLocal" as IpcChannel);

  await expect(
    create?.(event, {
      sourceId,
      title: "Planejamento",
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
      joinUrl: "https://user:password@calendar.example/event",
    }),
  ).rejects.toThrow();
  await expect(
    create?.(event, {
      sourceId,
      title: "Planejamento",
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
      sourceUrl: "https://calendar.example/event?TOKEN=never-send-this",
    }),
  ).rejects.toThrow();
  await expect(
    create?.(event, {
      sourceId,
      title: "Planejamento",
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
      sourceUrl:
        "https://calendar.example/event?accessToken=never-send-this&cookie=session",
    }),
  ).rejects.toThrow();
  expect(calendarService.createLocalEvent).not.toHaveBeenCalled();

  calendarService.createLocalEvent.mockReturnValueOnce({
    ...timedEvent,
    sourceUrl: "https://calendar.example/event?signature=never-send-this",
  } as unknown as typeof timedEvent);
  await expect(
    create?.(event, {
      sourceId,
      title: "Planejamento",
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
    }),
  ).rejects.toThrow();
  expect(calendarService.createLocalEvent).toHaveBeenCalledOnce();
});

it("enforces Calendar public text boundaries and real all-day dates before dispatch", async () => {
  const { calendarService, handlers, event } = harness();
  const createSource = handlers.get(
    "calendar:source:createLocal" as IpcChannel,
  );
  const createEvent = handlers.get("calendar:event:createLocal" as IpcChannel);

  await expect(
    createSource?.(event, {
      displayName: "s".repeat(255),
      color: "#0EA5E9",
      timezone: "America/Sao_Paulo",
    }),
  ).resolves.toEqual(source);
  await expect(
    createSource?.(event, {
      displayName: "s".repeat(256),
      color: "#0EA5E9",
      timezone: "America/Sao_Paulo",
    }),
  ).rejects.toThrow();
  await expect(
    createEvent?.(event, {
      sourceId,
      title: "t".repeat(1000),
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
    }),
  ).resolves.toEqual(timedEvent);
  await expect(
    createEvent?.(event, {
      sourceId,
      title: "t".repeat(1001),
      timezone: "America/Sao_Paulo",
      allDay: false,
      startsAt: "2026-07-21T12:00:00-03:00",
      endsAt: "2026-07-21T13:00:00-03:00",
    }),
  ).rejects.toThrow();
  await expect(
    createEvent?.(event, {
      sourceId,
      title: "Dia inteiro",
      timezone: "America/Sao_Paulo",
      allDay: true,
      startDate: "2026-02-30",
      endDate: "2026-03-01",
    }),
  ).rejects.toThrow();

  expect(calendarService.createLocalSource).toHaveBeenCalledOnce();
  expect(calendarService.createLocalEvent).toHaveBeenCalledOnce();
});
