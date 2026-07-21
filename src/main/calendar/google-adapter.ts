import { createHash } from "node:crypto";
import type { ConnectorCredential } from "../connectors/credential-vault";
import { GOOGLE_CALENDAR_READONLY_SCOPE } from "../connectors/google-oauth";
import type { CalendarSyncUpsert } from "./service";
import type { RemoteCalendarSnapshot } from "./remote-adapter";

const CALENDAR_LIST_URL =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const MAX_PAGES = 100;

interface CredentialReader {
  get(accountId: string): Promise<ConnectorCredential | null>;
}

interface GoogleCalendarSyncInput {
  accountId: string;
  timezone: string;
}

export interface GoogleCalendarSynchronizer {
  synchronize(input: GoogleCalendarSyncInput): Promise<RemoteCalendarSnapshot>;
}

type Fetcher = typeof fetch;
type Json = Record<string, unknown>;

export class GoogleCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

export class GoogleCalendarAdapter implements GoogleCalendarSynchronizer {
  constructor(
    private readonly credentials: CredentialReader,
    private readonly fetcher: Fetcher = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async synchronize(
    input: GoogleCalendarSyncInput,
  ): Promise<RemoteCalendarSnapshot> {
    const credential = await this.requireCredential(input.accountId);
    const calendars = await this.listCalendars(credential.accessToken);
    const now = this.clock();
    const timeMin = shiftedYear(now, -1).toISOString();
    const timeMax = shiftedYear(now, 2).toISOString();
    const upserts: CalendarSyncUpsert[] = [];

    for (const calendar of calendars) {
      const events = await this.listEvents(
        credential.accessToken,
        calendar.id,
        timeMin,
        timeMax,
      );
      for (const event of events) {
        const mapped = mapEvent(event, calendar, input.timezone, now);
        if (mapped) upserts.push(mapped);
      }
    }

    const syncedAt = now.toISOString();
    const cursor = createHash("sha256")
      .update(
        upserts
          .map((event) => `${event.externalId}\u0000${event.providerUpdatedAt}`)
          .sort()
          .join("\u0001"),
      )
      .digest("hex");
    return { nextCursor: cursor, syncedAt, upserts };
  }

  private async requireCredential(accountId: string) {
    let credential: ConnectorCredential | null = null;
    try {
      credential = await this.credentials.get(accountId);
    } catch {
      // Expose a stable error without leaking vault details.
    }
    if (
      credential?.kind !== "oauth" ||
      !credential.google?.scopes.includes(GOOGLE_CALENDAR_READONLY_SCOPE)
    ) {
      throw new GoogleCalendarError(
        "Atualize o acesso da Conta Google para sincronizar a Agenda.",
      );
    }
    return credential;
  }

  private async listCalendars(accessToken: string): Promise<CalendarRef[]> {
    const items: CalendarRef[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(CALENDAR_LIST_URL);
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("showHidden", "false");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await this.getJson(url, accessToken);
      for (const item of arrayOfRecords(payload.items)) {
        if (item.selected === false || typeof item.id !== "string") continue;
        items.push({
          id: item.id,
          timezone:
            typeof item.timeZone === "string" ? item.timeZone : undefined,
        });
      }
      pageToken = stringValue(payload.nextPageToken);
      if (!pageToken) return items;
    }
    throw new GoogleCalendarError(
      "A lista de agendas do Google é muito grande.",
    );
  }

  private async listEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<Json[]> {
    const items: Json[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      url.searchParams.set("maxResults", "2500");
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await this.getJson(url, accessToken);
      items.push(...arrayOfRecords(payload.items));
      pageToken = stringValue(payload.nextPageToken);
      if (!pageToken) return items;
    }
    throw new GoogleCalendarError(
      "A agenda do Google possui eventos demais para uma sincronização segura.",
    );
  }

  private async getJson(url: URL, accessToken: string): Promise<Json> {
    try {
      const response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new GoogleCalendarError(
          response.status === 403
            ? "O Google Agenda recusou o acesso. Verifique se a Calendar API está habilitada e atualize o acesso."
            : `O Google Agenda retornou HTTP ${response.status}.`,
        );
      }
      const payload: unknown = await response.json();
      if (!record(payload)) throw new Error("invalid payload");
      return payload;
    } catch (error) {
      if (error instanceof GoogleCalendarError) throw error;
      throw new GoogleCalendarError(
        "Não foi possível sincronizar o Google Agenda.",
      );
    }
  }
}

interface CalendarRef {
  id: string;
  timezone?: string;
}

function mapEvent(
  event: Json,
  calendar: CalendarRef,
  fallbackTimezone: string,
  now: Date,
): CalendarSyncUpsert | null {
  if (typeof event.id !== "string") return null;
  const start = record(event.start) ? event.start : {};
  const end = record(event.end) ? event.end : {};
  const timezone =
    stringValue(start.timeZone) ?? calendar.timezone ?? fallbackTimezone;
  const common = {
    externalId: `${encodeURIComponent(calendar.id)}:${event.id}`,
    title: stringValue(event.summary) ?? "Sem título",
    description: stringValue(event.description) ?? null,
    location: stringValue(event.location) ?? null,
    organizer: record(event.organizer)
      ? (stringValue(event.organizer.email) ?? null)
      : null,
    attendees: arrayOfRecords(event.attendees)
      .map((attendee) => stringValue(attendee.email))
      .filter((email): email is string => Boolean(email)),
    joinUrl: stringValue(event.hangoutLink) ?? conferenceUrl(event),
    sourceUrl: stringValue(event.htmlLink) ?? null,
    etag: stringValue(event.etag) ?? null,
    providerUpdatedAt: stringValue(event.updated) ?? now.toISOString(),
    status: calendarStatus(event.status),
    timezone,
  };
  const startDate = stringValue(start.date);
  const endDate = stringValue(end.date);
  if (startDate && endDate) {
    return { ...common, allDay: true, startDate, endDate };
  }
  const startsAt = stringValue(start.dateTime);
  const endsAt = stringValue(end.dateTime);
  if (!startsAt || !endsAt) return null;
  return { ...common, allDay: false, startsAt, endsAt };
}

function conferenceUrl(event: Json): string | null {
  if (!record(event.conferenceData)) return null;
  return (
    arrayOfRecords(event.conferenceData.entryPoints)
      .map((entry) => stringValue(entry.uri))
      .find(Boolean) ?? null
  );
}

function calendarStatus(
  value: unknown,
): "confirmed" | "tentative" | "cancelled" {
  return value === "tentative" || value === "cancelled" ? value : "confirmed";
}

function shiftedYear(value: Date, years: number): Date {
  const shifted = new Date(value);
  shifted.setUTCFullYear(shifted.getUTCFullYear() + years);
  return shifted;
}

function record(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayOfRecords(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
