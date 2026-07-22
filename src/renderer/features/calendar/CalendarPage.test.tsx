import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

const remoteSource = {
  id: "99999999-9999-4999-8999-999999999999",
  kind: "caldav" as const,
  displayName: "Agenda de clientes",
  color: "#8B5CF6",
  timezone: "Europe/Berlin",
  status: "active" as const,
  syncCursor: null,
  lastError: null,
  lastSyncedAt: now,
  createdAt: now,
  updatedAt: now,
} satisfies IpcResponse<"calendar:sources:list">[number];

const inboxAccounts = [
  {
    account: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "zoho" as const,
      displayName: "Marcos · trabalho",
      address: "marcos@okamiops.com",
      status: "connected" as const,
      syncCursor: null,
      lastError: null,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    configuration: {
      host: "imap.zoho.eu",
      port: 993,
      secure: true,
      mailbox: "INBOX",
      maxInitialMessages: 100,
      maxMessageBytes: 1_048_576,
    },
    hasCredential: true,
  },
] satisfies IpcResponse<"inbox:accounts:list">;

const events = [
  {
    id: eventId,
    sourceId: personalSourceId,
    externalId: eventId,
    title: "Planejamento semanal",
    description: `Event Name: Planejamento semanal
Additional Guests:
- marcos@example.com
- equipe@example.com
Date & Time: 21 de julho, 14:00
Location: This is a Google Meet web conference. You can join this meeting from your computer.
https://meet.google.com/abc-defg-hij
Need to make changes to this event?
Cancel: https://calendly.com/cancellations/event-1
Reschedule: https://calendly.com/reschedulings/event-1`,
    location: "Google Meet (instructions in description)",
    organizer: null,
    joinUrl: null,
    sourceUrl: null,
    etag: null,
    providerUpdatedAt: null,
    attendees: [],
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
  {
    id: "66666666-6666-4666-8666-666666666666",
    sourceId: personalSourceId,
    externalId: "66666666-6666-4666-8666-666666666666",
    title: "DevSecOps Podcast & Lisi Hocke",
    description:
      "The session will be hosted on Riverside, an online recording studio. There's no software to download, just click the link below.",
    location:
      "https://riverside.com/studio/cssio-batista-pereiras-studio?token=event-token",
    organizer: null,
    joinUrl: null,
    sourceUrl: "https://calendar.google.com/calendar/event?eid=riverside",
    etag: null,
    providerUpdatedAt: null,
    attendees: ["msant262@gmail.com"],
    status: "confirmed" as const,
    allDay: false as const,
    timezone: "Europe/Warsaw",
    startsAt: "2026-07-22T11:00:00.000Z",
    endsAt: "2026-07-22T12:00:00.000Z",
    startDate: null,
    endDate: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    sourceId: workSourceId,
    externalId: "77777777-7777-4777-8777-777777777777",
    title: "DreamSquad <> Vantion",
    description: "Reunião de acompanhamento com o time.",
    location: "Google Meet",
    organizer: null,
    joinUrl: null,
    sourceUrl: "https://calendar.google.com/calendar/event?eid=meet-fallback",
    etag: null,
    providerUpdatedAt: null,
    attendees: ["benhur@vantion.com.br", "bruna.matassa@dreamsquad.com.br"],
    status: "confirmed" as const,
    allDay: false as const,
    timezone: "America/Araguaina",
    startsAt: "2026-07-23T12:00:00.000Z",
    endsAt: "2026-07-23T13:00:00.000Z",
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
    listAccounts: vi.fn().mockResolvedValue(inboxAccounts),
    createLinkedSource: vi.fn().mockResolvedValue(remoteSource),
    listEvents: vi.fn().mockResolvedValue(events),
    createEvent: vi.fn().mockResolvedValue(events[0]),
    openExternal: vi.fn().mockResolvedValue({ opened: true }),
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
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
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeVisible();
    expect(container.querySelector(".calendar-shell")).toBeTruthy();
  });

  it("renders local timed and all-day events, filters sources and opens the inspector", async () => {
    const { api } = renderCalendar();
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
    expect(screen.getByText("Google Meet")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Entrar na reunião" }),
    );
    expect(api.openExternal).toHaveBeenCalledWith({
      url: "https://meet.google.com/abc-defg-hij",
    });
    expect(
      screen.getByRole("button", { name: "Reagendar evento" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Cancelar evento" }),
    ).toBeVisible();
    expect(screen.getByText("marcos@example.com")).toBeVisible();
    expect(screen.getByText("equipe@example.com")).toBeVisible();
    expect(screen.queryByText(/Event Name:/)).toBeNull();
    expect(document.querySelector(".calendar-inspector--drawer")).toBeTruthy();
  });

  it("turns location and source links into explicit event actions without exposing raw URLs", async () => {
    const { api } = renderCalendar();

    await userEvent.click(
      await screen.findByRole("button", {
        name: /DevSecOps Podcast & Lisi Hocke/,
      }),
    );
    expect(screen.getByText("Riverside")).toBeVisible();
    expect(screen.queryByText(/riverside\.com\/studio/)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Entrar na Riverside" }),
    );
    expect(api.openExternal).toHaveBeenCalledWith({
      url: "https://riverside.com/studio/cssio-batista-pereiras-studio?token=event-token",
    });

    await userEvent.click(
      screen.getByRole("button", { name: /DreamSquad <> Vantion/ }),
    );
    expect(screen.getByText("Google Meet")).toBeVisible();
    expect(screen.getByText(/convite não trouxe o link direto/i)).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Abrir no Google Agenda" }),
    );
    expect(api.openExternal).toHaveBeenCalledWith({
      url: "https://calendar.google.com/calendar/event?eid=meet-fallback",
    });
  });

  it("offers a linked calendar from Inbox accounts before the local agenda fallback", async () => {
    const { api } = renderCalendar();
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova agenda" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Conectar agenda" }),
    ).toBeVisible();
    expect(screen.getByText("IMAP sozinho não lê sua agenda.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Tipo de conexão"), {
      target: { value: "caldav" },
    });
    expect(screen.getByLabelText("Conta do Inbox")).toHaveTextContent(
      "Marcos · trabalho",
    );
    fireEvent.change(screen.getByLabelText("Conta do Inbox"), {
      target: { value: inboxAccounts[0].account.id },
    });
    fireEvent.change(screen.getByLabelText("URL da agenda"), {
      target: { value: "https://calendar.zoho.eu/caldav/marcos" },
    });
    fireEvent.change(screen.getByLabelText("Nome da agenda"), {
      target: { value: "Zoho trabalho" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Vincular agenda" }),
    );

    await vi.waitFor(() =>
      expect(api.createLinkedSource).toHaveBeenCalledWith({
        accountId: inboxAccounts[0].account.id,
        protocol: "caldav",
        authentication: "account",
        calendarUrl: "https://calendar.zoho.eu/caldav/marcos",
        displayName: "Zoho trabalho",
        color: "#FF7A1A",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
  });

  it("connects Google Agenda through its private iCal address without API billing", async () => {
    const { api } = renderCalendar();
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova agenda" }),
    );

    expect(screen.getByLabelText("Tipo de conexão")).toHaveValue("google");
    expect(screen.getByText(/endereço secreto em formato iCal/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText("URL da agenda"), {
      target: {
        value: "https://calendar.google.com/calendar/ical/private/basic.ics",
      },
    });
    fireEvent.change(screen.getByLabelText("Nome da agenda"), {
      target: { value: "Google pessoal" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Vincular agenda" }),
    );

    await vi.waitFor(() =>
      expect(api.createLinkedSource).toHaveBeenCalledWith({
        accountId: inboxAccounts[0].account.id,
        protocol: "ics",
        authentication: "none",
        calendarUrl:
          "https://calendar.google.com/calendar/ical/private/basic.ics",
        displayName: "Google pessoal",
        color: "#FF7A1A",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
  });

  it("creates a local source with the exact typed request and refreshes", async () => {
    const { api } = renderCalendar();
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova agenda" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Criar agenda local" }),
    );
    fireEvent.change(screen.getByLabelText("Nome da agenda"), {
      target: { value: "Clientes" },
    });
    fireEvent.change(screen.getByLabelText("Cor da agenda"), {
      target: { value: "#FF7A1A" },
    });
    fireEvent.change(screen.getByLabelText("Fuso horário"), {
      target: { value: "America/Sao_Paulo" },
    });
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
  }, 10_000);

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
  }, 10_000);

  it("renders returned active remote sources and requests events for every active source", async () => {
    const remoteEvent = {
      ...events[0],
      id: "66666666-6666-4666-8666-666666666666",
      sourceId: remoteSource.id,
      title: "Reunião remota configurada",
    };
    const { api } = renderCalendar(
      makeApi({
        listSources: vi.fn().mockResolvedValue([...sources, remoteSource]),
        listEvents: vi.fn().mockResolvedValue([...events, remoteEvent]),
      }),
    );

    expect(await screen.findByText("Agenda de clientes")).toBeVisible();
    expect(
      await screen.findByRole("button", { name: /Reunião remota configurada/ }),
    ).toBeVisible();
    expect(vi.mocked(api.listEvents).mock.calls[0]?.[0]?.sourceIds).toEqual([
      personalSourceId,
      workSourceId,
      remoteSource.id,
    ]);
  });

  it("never renders events returned for an unknown or inactive source", async () => {
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

  it("switches Day, Week and Month views while keeping event selection available", async () => {
    renderCalendar();
    await screen.findByRole("button", { name: /Planejamento semanal/ });

    const day = screen.getByRole("button", { name: "Dia" });
    const week = screen.getByRole("button", { name: "Semana" });
    const month = screen.getByRole("button", { name: "Mês" });
    expect(week).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(day);
    expect(day).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Dia selecionado")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: /Planejamento semanal/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Planejamento semanal" }),
    ).toBeVisible();

    await userEvent.click(month);
    expect(month).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByLabelText("Mês selecionado")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Planejamento semanal/ }),
    ).toBeVisible();
  });

  it("segments overnight timed events across both calendar days", async () => {
    const overnightEvent = {
      ...events[0],
      id: "77777777-7777-4777-8777-777777777777",
      externalId: "77777777-7777-4777-8777-777777777777",
      sourceId: workSourceId,
      title: "Plantão noturno",
      timezone: "Europe/Berlin",
      startsAt: "2026-07-21T21:30:00.000Z",
      endsAt: "2026-07-21T23:30:00.000Z",
    };
    renderCalendar(
      makeApi({
        listEvents: vi.fn().mockResolvedValue([...events, overnightEvent]),
      }),
    );

    const segments = await screen.findAllByRole("button", {
      name: /Plantão noturno/,
    });
    expect(segments).toHaveLength(2);
    expect(segments[0]?.style.getPropertyValue("--event-top")).toBe(
      "97.91666666666666%",
    );
    expect(segments[1]?.style.getPropertyValue("--event-top")).toBe("0%");
  });

  it("requests the visible Day, Week and complete Month ranges when navigating", async () => {
    const { api } = renderCalendar();
    await screen.findByRole("button", { name: /Planejamento semanal/ });

    await userEvent.click(screen.getByRole("button", { name: "Dia" }));
    await vi.waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.listEvents).mock.calls.at(-1)?.[0]).toMatchObject({
      startDate: "2026-07-21",
      endDate: "2026-07-22",
    });
    await userEvent.click(screen.getByRole("button", { name: "Próximo dia" }));
    await vi.waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.listEvents).mock.calls.at(-1)?.[0]).toMatchObject({
      startDate: "2026-07-22",
      endDate: "2026-07-23",
    });

    await userEvent.click(screen.getByRole("button", { name: "Semana" }));
    await vi.waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(4));
    expect(vi.mocked(api.listEvents).mock.calls.at(-1)?.[0]).toMatchObject({
      startDate: "2026-07-20",
      endDate: "2026-07-27",
    });

    await userEvent.click(screen.getByRole("button", { name: "Mês" }));
    await vi.waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(5));
    expect(vi.mocked(api.listEvents).mock.calls.at(-1)?.[0]).toMatchObject({
      startDate: "2026-06-29",
      endDate: "2026-08-10",
    });
  });

  it("retries failed source and event reads without blocking calendar navigation", async () => {
    const listSources = vi
      .fn()
      .mockRejectedValueOnce(new Error("indisponível"))
      .mockResolvedValue(sources);
    const sourceApi = makeApi({ listSources });
    renderCalendar(sourceApi);
    expect(
      await screen.findByRole("alert", { name: "Erro ao carregar agendas" }),
    ).toHaveTextContent("Não foi possível carregar as agendas.");
    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" }),
    );
    await vi.waitFor(() => expect(listSources).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Pessoal")).toBeVisible();

    const listEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error("indisponível"))
      .mockResolvedValue(events);
    cleanup();
    renderCalendar(makeApi({ listEvents }));
    expect(
      await screen.findByRole("alert", { name: "Erro ao carregar eventos" }),
    ).toHaveTextContent("Não foi possível carregar os eventos.");
    await userEvent.click(
      screen.getByRole("button", { name: "Tentar novamente" }),
    );
    await vi.waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", { name: /Planejamento semanal/ }),
    ).toBeVisible();
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
    ).toHaveTextContent("Não foi possível carregar as agendas.");
    expect(screen.queryByLabelText("Provedores remotos")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Conectar|Sincronizar/i }),
    ).toBeNull();
  });
});
