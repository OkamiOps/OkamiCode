import { describe, expect, it, vi } from "vitest";
import type { ConnectorCredential } from "../connectors/credential-vault";
import { RemoteCalendarAdapter } from "./remote-adapter";

const accountId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
const source = {
  id: "4d32d86d-3199-4327-9d0c-e283268ed239",
  kind: "caldav" as const,
  displayName: "Trabalho",
  color: "#FF7A1A",
  timezone: "America/Sao_Paulo",
  status: "active" as const,
  syncCursor: null,
  lastError: null,
  lastSyncedAt: null,
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
};

function response(body: string, status = 200, etag = '"feed-v1"') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === "etag" ? etag : null) },
    text: async () => body,
  };
}

describe("RemoteCalendarAdapter", () => {
  it("uses the Inbox credential for CalDAV REPORT and parses timed and all-day VEVENTs", async () => {
    const credential: ConnectorCredential = {
      version: 1,
      kind: "imap_password",
      username: "marcos@example.com",
      password: "fixture-secret",
    };
    const fetch = vi.fn(async () =>
      response(`<?xml version="1.0"?><multistatus xmlns:c="urn:ietf:params:xml:ns:caldav">
        <response><propstat><prop><c:calendar-data><![CDATA[BEGIN:VCALENDAR
BEGIN:VEVENT
UID:timed-1
SUMMARY:Planejamento
DTSTART;TZID=America/Sao_Paulo:20260721T090000
DTEND;TZID=America/Sao_Paulo:20260721T100000
LAST-MODIFIED:20260721T110000Z
ATTENDEE:mailto:ana@example.com
END:VEVENT
BEGIN:VEVENT
UID:day-1
SUMMARY:Feriado
DTSTART;VALUE=DATE:20260722
DTEND;VALUE=DATE:20260723
DTSTAMP:20260720T120000Z
END:VEVENT
END:VCALENDAR]]></c:calendar-data></prop></propstat></response></multistatus>`),
    );
    const adapter = new RemoteCalendarAdapter(
      { get: vi.fn(async () => credential) },
      fetch,
      () => new Date("2026-07-21T12:00:00.000Z"),
    );

    const snapshot = await adapter.synchronize({
      source,
      accountId,
      protocol: "caldav",
      authentication: "account",
      calendarUrl: "https://calendar.example/caldav/marcos",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://calendar.example/caldav/marcos",
      expect.objectContaining({
        method: "REPORT",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("marcos@example.com:fixture-secret").toString("base64")}`,
          Depth: "1",
        }),
      }),
    );
    expect(snapshot.upserts).toEqual([
      expect.objectContaining({
        externalId: "timed-1",
        title: "Planejamento",
        allDay: false,
        startsAt: "2026-07-21T12:00:00.000Z",
        endsAt: "2026-07-21T13:00:00.000Z",
        attendees: ["ana@example.com"],
      }),
      expect.objectContaining({
        externalId: "day-1",
        title: "Feriado",
        allDay: true,
        startDate: "2026-07-22",
        endDate: "2026-07-23",
      }),
    ]);
    expect(snapshot.nextCursor).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses ICS GET with OAuth and exposes only a safe failure", async () => {
    const fetch = vi.fn(async () => response("access-token-secret", 401));
    const adapter = new RemoteCalendarAdapter(
      {
        get: vi.fn(async () =>
          Promise.resolve<ConnectorCredential>({
            version: 1,
            kind: "oauth",
            username: "marcos@example.com",
            accessToken: "access-token-secret",
          }),
        ),
      },
      fetch,
    );

    await expect(
      adapter.synchronize({
        source: { ...source, kind: "ics" },
        accountId,
        protocol: "ics",
        authentication: "account",
        calendarUrl: "https://calendar.example/feed.ics",
      }),
    ).rejects.toThrow("Calendar server returned HTTP 401");
    expect(fetch).toHaveBeenCalledWith(
      "https://calendar.example/feed.ics",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token-secret",
        }),
      }),
    );
    await expect(
      adapter.synchronize({
        source: { ...source, kind: "ics" },
        accountId,
        protocol: "ics",
        authentication: "account",
        calendarUrl: "https://calendar.example/feed.ics",
      }),
    ).rejects.not.toThrow(/access-token-secret/u);
  });

  it("downloads a private Google iCal feed without leaking Inbox credentials", async () => {
    const getCredential = vi.fn();
    const fetch = vi.fn(async () =>
      response(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:google-1
SUMMARY:Reunião Google
DTSTART:20260721T090000Z
DTEND:20260721T100000Z
END:VEVENT
END:VCALENDAR`),
    );
    const adapter = new RemoteCalendarAdapter(
      { get: getCredential },
      fetch,
      () => new Date("2026-07-21T12:00:00.000Z"),
    );

    const snapshot = await adapter.synchronize({
      source: { ...source, kind: "ics" },
      accountId,
      protocol: "ics",
      authentication: "none",
      calendarUrl:
        "https://calendar.google.com/calendar/ical/private/basic.ics",
    } as never);

    expect(getCredential).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://calendar.google.com/calendar/ical/private/basic.ics",
      {
        method: "GET",
        headers: { Accept: "text/calendar, application/xml;q=0.9" },
      },
    );
    expect(snapshot.upserts[0]).toMatchObject({
      externalId: "google-1",
      title: "Reunião Google",
    });
  });
});
