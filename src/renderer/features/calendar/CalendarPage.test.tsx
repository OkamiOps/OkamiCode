import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { App } from "../../app/App";
import { installOkamiMock } from "../../test/okami-mock";
import { CalendarPage, type CalendarApi } from "./CalendarPage";

const personalSourceId = "11111111-1111-4111-8111-111111111111";
const workSourceId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const now = "2026-07-21T12:00:00.000Z";

const sources = [
  {
    id: personalSourceId,
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
  },
  {
    id: workSourceId,
    kind: "local" as const,
    displayName: "Trabalho",
    color: "#FF7A1A",
    timezone: "Europe/Berlin",
    status: "active" as const,
    syncCursor: null,
    lastError: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  },
] satisfies IpcResponse<"calendar:sources:list">;

const events = [
  {
    id: eventId,
    sourceId: personalSourceId,
    externalId: eventId,
    title: "Planejamento semanal",
    description: "Prioridades da semana",
    location: "Sala Atlas",
    organizer: null,
    joinUrl: "https://meet.example.com/planejamento",
    sourceUrl: null,
    etag: null,
    providerUpdatedAt: null,
    attendees: ["marcos@example.com"],
    status: "confirmed" as const,
    allDay: false as const,
    timezone: "America/Sao_Paulo",
    startsAt: "2026-07-21T12:00:00.000Z",
    endsAt: "2026-07-21T13:00:00.000Z",
    startDate: null,
    endDate: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    sourceId: workSourceId,
    externalId: "44444444-4444-4444-8444-444444444444",
    title: "Feriado local",
    description: null,
    location: null,
    organizer: null,
    joinUrl: null,
    sourceUrl: null,
    etag: null,
    providerUpdatedAt: null,
    attendees: [],
    status: "tentative" as const,
    allDay: true as const,
    timezone: "Europe/Berlin",
    startsAt: null,
    endsAt: null,
    startDate: "2026-07-21",
    endDate: "2026-07-22",
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    sourceId: workSourceId,
    externalId: "55555555-5555-4555-8555-555555555555",
    title: "Virada em Berlim",
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
    timezone: "Europe/Berlin",
    startsAt: "2026-07-20T22:30:00.000Z",
    endsAt: "2026-07-20T23:30:00.000Z",
    startDate: null,
    endDate: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  },
] satisfies IpcResponse<"calendar:events:list">;

function localDay() {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function makeApi(overrides: Partial<CalendarApi> = {}): CalendarApi {
  return {
    listSources: vi.fn().mockResolvedValue(sources),
    createSource: vi.fn().mockResolvedValue(sources[0]),
    listEvents: vi.fn().mockResolvedValue(events),
    createEvent: vi.fn().mockResolvedValue(events[0]),
    ...overrides,
  };
}

function renderCalendar(api = makeApi(), displayTimezone = "Europe/Berlin") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    api,
    ...render(
      <QueryClientProvider client={queryClient}>
        <CalendarPage api={api} displayTimezone={displayTimezone} />
      </QueryClientProvider>,
    ),
  };
}

describe("CalendarPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    installOkamiMock({
      "calendar:sources:list": sources,
      "calendar:events:list": events,
    });
  });

  it("wires Agenda to the dedicated shell without the conversation sidebar", async () => {
    window.history.replaceState({}, "", "/#/workbench");
    const { container } = render(<App />);

    await userEvent.click(await screen.findByRole("link", { name: "Agenda" }));
    expect(
      await screen.findByRole("heading", { name: "Agenda" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Agenda" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("button", { name: "Nova conversa" })).toBeNull();
    expect(container.querySelector(".calendar-shell")).toBeTruthy();
  });

  it("renders local timed and all-day events, filters sources and opens the inspector", async () => {
    renderCalendar();
    expect(
      await screen.findByRole("button", { name: /Planejamento semanal/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Feriado local/ })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /Trabalho/ }));
    expect(screen.queryByRole("button", { name: /Feriado local/ })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: /Planejamento semanal/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Planejamento semanal" }),
    ).toBeVisible();
    expect(screen.getByText("America/Sao_Paulo")).toBeVisible();
    expect(screen.getByText("Sala Atlas")).toBeVisible();
    expect(screen.getByRole("link", { name: "Abrir chamada" })).toHaveAttribute(
      "href",
      "https://meet.example.com/planejamento",
    );
    expect(document.querySelector(".calendar-inspector--drawer")).toBeTruthy();
  });

  it("creates a local source with the exact typed request and refreshes", async () => {
    const { api } = renderCalendar();
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova agenda" }),
    );
    await userEvent.clear(screen.getByLabelText("Nome da agenda"));
    await userEvent.type(screen.getByLabelText("Nome da agenda"), "Clientes");
    await userEvent.clear(screen.getByLabelText("Cor da agenda"));
    await userEvent.type(screen.getByLabelText("Cor da agenda"), "#FF7A1A");
    await userEvent.clear(screen.getByLabelText("Fuso horário"));
    await userEvent.type(
      screen.getByLabelText("Fuso horário"),
      "America/Sao_Paulo",
    );
    await userEvent.click(screen.getByRole("button", { name: "Criar agenda" }));

    await vi.waitFor(() =>
      expect(api.createSource).toHaveBeenCalledWith({
        displayName: "Clientes",
        color: "#FF7A1A",
        timezone: "America/Sao_Paulo",
      }),
    );
    await vi.waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(2));
  });

  it("creates local timed and all-day events with typed requests and refreshes", async () => {
    const { api } = renderCalendar();
    await userEvent.click(
      await screen.findByRole("button", { name: "Novo evento" }),
    );
    await userEvent.type(screen.getByLabelText("Título do evento"), "Reunião");
    await userEvent.click(
      screen.getByRole("button", { name: "Salvar evento" }),
    );

    await vi.waitFor(() =>
      expect(api.createEvent).toHaveBeenCalledWith({
        sourceId: personalSourceId,
        title: "Reunião",
        timezone: "America/Sao_Paulo",
        allDay: false,
        startsAt: `${localDay()}T12:00:00.000Z`,
        endsAt: `${localDay()}T13:00:00.000Z`,
      }),
    );
    await vi.waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole("button", { name: "Novo evento" }));
    await userEvent.type(screen.getByLabelText("Título do evento"), "Folga");
    await userEvent.click(screen.getByLabelText("Dia inteiro"));
    await userEvent.clear(screen.getByLabelText("Data inicial"));
    await userEvent.type(screen.getByLabelText("Data inicial"), "2026-08-03");
    await userEvent.clear(screen.getByLabelText("Data final"));
    await userEvent.type(screen.getByLabelText("Data final"), "2026-08-04");
    await userEvent.click(
      screen.getByRole("button", { name: "Salvar evento" }),
    );

    await vi.waitFor(() =>
      expect(api.createEvent).toHaveBeenLastCalledWith({
        sourceId: personalSourceId,
        title: "Folga",
        timezone: "America/Sao_Paulo",
        allDay: true,
        startDate: "2026-08-03",
        endDate: "2026-08-04",
      }),
    );
  });

  it("uses event IANA timezones for DST-safe wall time and rejects nonexistent local time", async () => {
    const { api } = renderCalendar(makeApi(), "America/Sao_Paulo");
    expect(
      await screen.findByRole("button", {
        name: /Virada em Berlim, 19:30 — 20:30/,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Agenda de seg 20" }),
    ).toContainElement(
      screen.getByRole("button", { name: /Virada em Berlim/ }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Novo evento" }));
    await userEvent.selectOptions(
      screen.getByLabelText("Agenda do evento"),
      workSourceId,
    );
    await userEvent.type(
      screen.getByLabelText("Título do evento"),
      "Virada de verão",
    );
    await userEvent.clear(screen.getByLabelText("Data inicial"));
    await userEvent.type(screen.getByLabelText("Data inicial"), "2026-07-21");
    await userEvent.clear(screen.getByLabelText("Data final"));
    await userEvent.type(screen.getByLabelText("Data final"), "2026-07-21");
    await userEvent.clear(screen.getByLabelText("Hora inicial"));
    await userEvent.type(screen.getByLabelText("Hora inicial"), "00:30");
    await userEvent.clear(screen.getByLabelText("Hora final"));
    await userEvent.type(screen.getByLabelText("Hora final"), "01:30");
    await userEvent.click(
      screen.getByRole("button", { name: "Salvar evento" }),
    );

    await vi.waitFor(() =>
      expect(api.createEvent).toHaveBeenCalledWith({
        sourceId: workSourceId,
        title: "Virada de verão",
        timezone: "Europe/Berlin",
        allDay: false,
        startsAt: "2026-07-20T22:30:00.000Z",
        endsAt: "2026-07-20T23:30:00.000Z",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Novo evento" }));
    await userEvent.selectOptions(
      screen.getByLabelText("Agenda do evento"),
      workSourceId,
    );
    await userEvent.type(
      screen.getByLabelText("Título do evento"),
      "Horário inexistente",
    );
    await userEvent.clear(screen.getByLabelText("Data inicial"));
    await userEvent.type(screen.getByLabelText("Data inicial"), "2026-03-29");
    await userEvent.clear(screen.getByLabelText("Data final"));
    await userEvent.type(screen.getByLabelText("Data final"), "2026-03-29");
    await userEvent.clear(screen.getByLabelText("Hora inicial"));
    await userEvent.type(screen.getByLabelText("Hora inicial"), "02:30");
    await userEvent.clear(screen.getByLabelText("Hora final"));
    await userEvent.type(screen.getByLabelText("Hora final"), "03:30");
    await userEvent.click(
      screen.getByRole("button", { name: "Salvar evento" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Data ou horário inválido para o fuso horário escolhido.",
    );
    expect(api.createEvent).toHaveBeenCalledOnce();
  });

  it("never renders events returned for a remote or unknown source", async () => {
    const remoteEvent = {
      ...events[0],
      id: "66666666-6666-4666-8666-666666666666",
      sourceId: "77777777-7777-4777-8777-777777777777",
      title: "Evento remoto não configurado",
    };
    renderCalendar(
      makeApi({
        listEvents: vi.fn().mockResolvedValue([...events, remoteEvent]),
      }),
    );

    await screen.findByRole("button", { name: /Planejamento semanal/ });
    expect(
      screen.queryByRole("button", { name: /Evento remoto não configurado/ }),
    ).toBeNull();
  });

  it("shows honest empty and error states without provider connect or sync actions", async () => {
    renderCalendar(
      makeApi({
        listSources: vi.fn().mockRejectedValue(new Error("indisponível")),
        listEvents: vi.fn().mockResolvedValue([]),
      }),
    );
    expect(
      await screen.findByRole("alert", { name: "Erro ao carregar agendas" }),
    ).toHaveTextContent("Não foi possível carregar as agendas locais.");
    expect(screen.getByText("Google · não configurado")).toBeVisible();
    expect(screen.getByText("Outlook · não configurado")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Conectar|Sincronizar/i }),
    ).toBeNull();
  });
});
