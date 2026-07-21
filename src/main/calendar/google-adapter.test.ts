import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarAdapter } from "./google-adapter";

const credential = {
  version: 1 as const,
  kind: "oauth" as const,
  username: "marcos@gmail.com",
  accessToken: "secret-token",
  refreshToken: "refresh",
  google: {
    clientId: "desktop.apps.googleusercontent.com",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  },
};

describe("GoogleCalendarAdapter", () => {
  it("paginates calendars and events while expanding recurring instances", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      let payload: unknown;
      if (url.pathname.endsWith("/calendarList")) {
        payload = url.searchParams.has("pageToken")
          ? { items: [{ id: "shared@example.com", selected: true }] }
          : {
              items: [
                { id: "primary", selected: true, timeZone: "Europe/Berlin" },
              ],
              nextPageToken: "cal-2",
            };
      } else if (
        url.pathname.includes("primary") &&
        !url.searchParams.has("pageToken")
      ) {
        payload = {
          items: [
            {
              id: "recurring-instance-1",
              summary: "Daily",
              updated: "2026-07-21T10:00:00.000Z",
              start: { dateTime: "2026-07-22T09:00:00+02:00" },
              end: { dateTime: "2026-07-22T09:30:00+02:00" },
            },
          ],
          nextPageToken: "event-2",
        };
      } else if (url.pathname.includes("primary")) {
        payload = {
          items: [
            {
              id: "all-day",
              summary: "Feriado",
              start: { date: "2026-07-23" },
              end: { date: "2026-07-24" },
            },
          ],
        };
      } else {
        payload = { items: [] };
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const adapter = new GoogleCalendarAdapter(
      { get: vi.fn(async () => credential) },
      fetcher as typeof fetch,
      () => new Date("2026-07-21T12:00:00.000Z"),
    );

    const snapshot = await adapter.synchronize({
      accountId: "account",
      timezone: "UTC",
    });

    expect(snapshot.upserts).toHaveLength(2);
    expect(snapshot.upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: "primary:recurring-instance-1",
          allDay: false,
        }),
        expect.objectContaining({
          externalId: "primary:all-day",
          allDay: true,
        }),
      ]),
    );
    const eventUrls = fetcher.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname.endsWith("/events"));
    expect(eventUrls[0]?.searchParams.get("singleEvents")).toBe("true");
    expect(eventUrls[0]?.searchParams.get("orderBy")).toBe("startTime");
    expect(eventUrls[0]?.searchParams.get("timeMin")).toBeTruthy();
    expect(eventUrls[0]?.searchParams.get("timeMax")).toBeTruthy();
    expect(
      eventUrls.some((url) => url.searchParams.get("pageToken") === "event-2"),
    ).toBe(true);
  });

  it("requires explicit Calendar authorization without leaking credentials", async () => {
    const adapter = new GoogleCalendarAdapter({
      get: vi.fn(async () => ({
        ...credential,
        google: { ...credential.google, scopes: [] },
      })),
    });
    await expect(
      adapter.synchronize({ accountId: "account", timezone: "UTC" }),
    ).rejects.toThrow("Atualize o acesso");
  });
});
