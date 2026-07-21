import { createHash } from "node:crypto";
import type { ConnectorCredential } from "../connectors/credential-vault";
import type {
  CalendarSource,
  CalendarSyncUpsert,
  CalendarEventStatus,
} from "./service";

export type LinkedCalendarProtocol = "caldav" | "ics";
export type LinkedCalendarAuthentication = "account" | "none";

export interface CalendarCredentialReader {
  get(accountId: string): Promise<ConnectorCredential | null>;
}

export interface CalendarFetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type CalendarFetch = (
  url: string,
  init: {
    method: "GET" | "REPORT";
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<CalendarFetchResponse>;

export interface RemoteCalendarSyncInput {
  source: CalendarSource;
  accountId: string;
  protocol: LinkedCalendarProtocol;
  authentication: LinkedCalendarAuthentication;
  calendarUrl: string;
}

export interface RemoteCalendarSnapshot {
  nextCursor: string;
  syncedAt: string;
  upserts: CalendarSyncUpsert[];
}

export interface RemoteCalendarSynchronizer {
  synchronize(input: RemoteCalendarSyncInput): Promise<RemoteCalendarSnapshot>;
}

export class RemoteCalendarError extends Error {
  constructor(message = "Calendar synchronization failed") {
    super(message);
    this.name = "RemoteCalendarError";
  }
}

const CALDAV_REPORT = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter>
</c:calendar-query>`;

export class RemoteCalendarAdapter implements RemoteCalendarSynchronizer {
  constructor(
    private readonly credentials: CalendarCredentialReader,
    private readonly fetcher: CalendarFetch = productionFetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async synchronize(
    input: RemoteCalendarSyncInput,
  ): Promise<RemoteCalendarSnapshot> {
    const headers: Record<string, string> = {
      Accept: "text/calendar, application/xml;q=0.9",
    };
    if (input.authentication === "account") {
      headers.Authorization = authorizationFor(
        await this.readCredential(input.accountId),
      );
    }
    const init =
      input.protocol === "caldav"
        ? {
            method: "REPORT" as const,
            headers: {
              ...headers,
              Depth: "1",
              "Content-Type": "application/xml; charset=utf-8",
            },
            body: CALDAV_REPORT,
          }
        : { method: "GET" as const, headers };

    let response: CalendarFetchResponse;
    try {
      response = await this.fetcher(input.calendarUrl, init);
    } catch {
      throw new RemoteCalendarError();
    }
    if (!response.ok) {
      throw new RemoteCalendarError(
        `Calendar server returned HTTP ${response.status}`,
      );
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      throw new RemoteCalendarError("Calendar response could not be read");
    }
    const syncedAt = this.clock().toISOString();
    try {
      return {
        nextCursor: createHash("sha256").update(body).digest("hex"),
        syncedAt,
        upserts: parseCalendarPayload(
          body,
          input.source.timezone,
          input.calendarUrl,
          response.headers.get("etag"),
          syncedAt,
        ),
      };
    } catch {
      throw new RemoteCalendarError("Calendar response is invalid");
    }
  }

  private async readCredential(
    accountId: string,
  ): Promise<ConnectorCredential> {
    try {
      const credential = await this.credentials.get(accountId);
      if (credential) return credential;
    } catch {
      // The vault error is deliberately replaced with a stable public error.
    }
    throw new RemoteCalendarError("Calendar credentials unavailable");
  }
}

const productionFetch: CalendarFetch = async (url, init) =>
  fetch(url, init) as Promise<CalendarFetchResponse>;

function authorizationFor(credential: ConnectorCredential): string {
  if (credential.kind === "oauth") {
    return `Bearer ${credential.accessToken}`;
  }
  return `Basic ${Buffer.from(
    `${credential.username}:${credential.password}`,
    "utf8",
  ).toString("base64")}`;
}

export function parseCalendarPayload(
  payload: string,
  defaultTimezone: string,
  calendarUrl: string | null,
  etag: string | null,
  syncedAt: string,
): CalendarSyncUpsert[] {
  const calendars = extractCalendarData(payload);
  const blocks = calendars.flatMap(
    (calendar) =>
      unfoldLines(calendar).match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/giu) ?? [],
  );
  return blocks.map((block) =>
    parseEvent(block, defaultTimezone, calendarUrl, etag, syncedAt),
  );
}

function extractCalendarData(payload: string): string[] {
  if (/BEGIN:VCALENDAR/iu.test(payload)) return [payload];
  const matches = [
    ...payload.matchAll(
      /<(?:[\w-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calendar-data>/giu,
    ),
  ];
  if (matches.length === 0) throw new Error("missing calendar data");
  return matches.map((match) => decodeXml(match[1] ?? ""));
}

function decodeXml(value: string): string {
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/u)?.[1];
  if (cdata !== undefined) return cdata;
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function unfoldLines(value: string): string {
  return value.replace(/\r?\n[ \t]/gu, "").replaceAll("\r\n", "\n");
}

interface IcalProperty {
  value: string;
  parameters: Map<string, string>;
}

function parseEvent(
  block: string,
  defaultTimezone: string,
  calendarUrl: string | null,
  etag: string | null,
  syncedAt: string,
): CalendarSyncUpsert {
  const properties = new Map<string, IcalProperty[]>();
  for (const line of block.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const descriptor = line.slice(0, separator).split(";");
    const name = descriptor.shift()?.toUpperCase();
    if (!name) continue;
    const parameters = new Map<string, string>();
    for (const parameter of descriptor) {
      const equals = parameter.indexOf("=");
      if (equals > 0) {
        parameters.set(
          parameter.slice(0, equals).toUpperCase(),
          parameter.slice(equals + 1).replace(/^"|"$/gu, ""),
        );
      }
    }
    const existing = properties.get(name) ?? [];
    existing.push({ value: line.slice(separator + 1), parameters });
    properties.set(name, existing);
  }
  const get = (name: string) => properties.get(name)?.[0];
  const uid = requiredValue(get("UID"), "UID");
  const start = get("DTSTART");
  const end = get("DTEND");
  if (!start || !end) throw new Error("missing event range");
  const isAllDay =
    start.parameters.get("VALUE")?.toUpperCase() === "DATE" ||
    /^\d{8}$/u.test(start.value);
  const timezone = start.parameters.get("TZID") ?? defaultTimezone;
  const status = eventStatus(get("STATUS")?.value);
  const common = {
    externalId: uid,
    title: unescapeText(get("SUMMARY")?.value ?? "Sem título"),
    description: optionalUnescaped(get("DESCRIPTION")?.value),
    location: optionalUnescaped(get("LOCATION")?.value),
    organizer: optionalAddress(get("ORGANIZER")?.value),
    sourceUrl: calendarUrl,
    attendees: (properties.get("ATTENDEE") ?? [])
      .map((property) => optionalAddress(property.value))
      .filter((value): value is string => value !== null),
    status,
    timezone,
    etag,
    providerUpdatedAt:
      parseIcalInstant(get("LAST-MODIFIED") ?? get("DTSTAMP"), "UTC") ??
      syncedAt,
  };
  if (isAllDay) {
    return {
      ...common,
      allDay: true,
      startDate: parseIcalDate(start.value),
      endDate: parseIcalDate(end.value),
    };
  }
  return {
    ...common,
    allDay: false,
    startsAt: parseIcalInstant(start, timezone)!,
    endsAt: parseIcalInstant(end, end.parameters.get("TZID") ?? timezone)!,
  };
}

function requiredValue(
  property: IcalProperty | undefined,
  name: string,
): string {
  const value = property?.value.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function eventStatus(value: string | undefined): CalendarEventStatus {
  switch (value?.toUpperCase()) {
    case "TENTATIVE":
      return "tentative";
    case "CANCELLED":
      return "cancelled";
    default:
      return "confirmed";
  }
}

function optionalUnescaped(value: string | undefined): string | null {
  return value === undefined ? null : unescapeText(value).trim() || null;
}

function optionalAddress(value: string | undefined): string | null {
  if (value === undefined) return null;
  return (
    unescapeText(value)
      .replace(/^mailto:/iu, "")
      .trim() || null
  );
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/gu, "\n")
    .replace(/\\,/gu, ",")
    .replace(/\\;/gu, ";")
    .replace(/\\\\/gu, "\\");
}

function parseIcalDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/u.exec(value.trim());
  if (!match) throw new Error("invalid calendar date");
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseIcalInstant(
  property: IcalProperty | undefined,
  timezone: string,
): string | null {
  if (!property) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/u.exec(
    property.value.trim(),
  );
  if (!match) throw new Error("invalid calendar timestamp");
  const parts = match.slice(1, 7).map(Number);
  if (match[7] === "Z") {
    return new Date(
      Date.UTC(
        ...((parts as [number, number, number, number, number, number]).map(
          (value, index) => (index === 1 ? value - 1 : value),
        ) as [number, number, number, number, number, number]),
      ),
    ).toISOString();
  }
  return zonedDateTimeToIso(
    parts as [number, number, number, number, number, number],
    property.parameters.get("TZID") ?? timezone,
  );
}

function zonedDateTimeToIso(
  [year, month, day, hour, minute, second]: [
    number,
    number,
    number,
    number,
    number,
    number,
  ],
  timezone: string,
): string {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const values = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const displayed = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    );
    candidate += desired - displayed;
  }
  return new Date(candidate).toISOString();
}
