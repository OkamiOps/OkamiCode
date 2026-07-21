import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../db/test-support";
import { CalendarService } from "./service";

function createService() {
  const fx = createTestDatabase();
  let id = 0;
  let tick = 0;
  return {
    ...fx,
    service: new CalendarService({
      db: fx.db,
      createId: () => `calendar-${++id}`,
      clock: () => `2026-07-21T00:00:${String(++tick).padStart(2, "0")}.000Z`,
    }),
  };
}

describe("CalendarService", () => {
  it("creates local sources in creation order and rejects invalid or remote-active sources", () => {
    const fx = createService();
    const first = fx.service.createLocalSource({
      displayName: "Equipe",
      color: "#336699",
      timezone: "America/Sao_Paulo",
    });
    const second = fx.service.createLocalSource({
      displayName: "Pessoal",
      color: "#ABCDEF",
      timezone: "UTC",
    });

    expect(fx.service.listSources()).toEqual([first, second]);
    expect(() =>
      fx.service.createLocalSource({
        displayName: " ",
        color: "blue",
        timezone: "UTC",
      }),
    ).toThrow();
    expect(() =>
      fx.db
        .prepare(
          `INSERT INTO calendar_sources
           (id, kind, display_name, color, timezone, status, created_at, updated_at)
           VALUES ('google', 'google', 'Google', '#123456', 'UTC', 'active', 'now', 'now')`,
        )
        .run(),
    ).toThrow();
  });

  it("requires offset timed datetimes, valid timezone and preserves instants through DST", () => {
    const fx = createService();
    const source = fx.service.createLocalSource({
      displayName: "Equipe",
      color: "#336699",
      timezone: "America/New_York",
    });
    expect(() =>
      fx.service.createLocalEvent({
        sourceId: source.id,
        title: "No offset",
        timezone: "America/New_York",
        allDay: false,
        startsAt: "2026-03-08T01:30:00",
        endsAt: "2026-03-08T03:30:00-04:00",
      }),
    ).toThrow();
    expect(() =>
      fx.service.createLocalEvent({
        sourceId: source.id,
        title: "Reverse",
        timezone: "Invalid/Zone",
        allDay: false,
        startsAt: "2026-03-08T01:30:00-05:00",
        endsAt: "2026-03-08T01:00:00-05:00",
      }),
    ).toThrow();

    const event = fx.service.createLocalEvent({
      sourceId: source.id,
      title: "DST",
      timezone: "America/New_York",
      allDay: false,
      startsAt: "2026-03-08T01:30:00-05:00",
      endsAt: "2026-03-08T03:30:00-04:00",
      attendees: [" B@example.com ", "a@example.com", "b@example.com"],
    });

    expect(event.startsAt).toBe("2026-03-08T06:30:00.000Z");
    expect(event.endsAt).toBe("2026-03-08T07:30:00.000Z");
    expect(event.attendees).toEqual(["a@example.com", "b@example.com"]);
    expect(event.externalId).toBe(event.id);
  });

  it("keeps all-day dates as exclusive date fields without datetime conversion", () => {
    const fx = createService();
    const source = fx.service.createLocalSource({
      displayName: "Pessoal",
      color: "#123456",
      timezone: "Europe/Berlin",
    });
    expect(() =>
      fx.service.createLocalEvent({
        sourceId: source.id,
        title: "Bad date",
        timezone: "Europe/Berlin",
        allDay: true,
        startDate: "2026-06-02",
        endDate: "2026-06-02",
      }),
    ).toThrow();
    const event = fx.service.createLocalEvent({
      sourceId: source.id,
      title: "Feriado",
      timezone: "Europe/Berlin",
      allDay: true,
      startDate: "2026-06-02",
      endDate: "2026-06-03",
    });
    expect(event).toMatchObject({
      allDay: true,
      startDate: "2026-06-02",
      endDate: "2026-06-03",
      startsAt: null,
      endsAt: null,
    });
  });

  it("lists overlap deterministically, filters sources, excludes deletions and preserves identity on update", () => {
    const fx = createService();
    const a = fx.service.createLocalSource({
      displayName: "A",
      color: "#111111",
      timezone: "UTC",
    });
    const b = fx.service.createLocalSource({
      displayName: "B",
      color: "#222222",
      timezone: "UTC",
    });
    const timed = fx.service.createLocalEvent({
      sourceId: a.id,
      title: "Timed",
      timezone: "UTC",
      allDay: false,
      startsAt: "2026-06-01T10:00:00+00:00",
      endsAt: "2026-06-01T12:00:00+00:00",
    });
    const allDay = fx.service.createLocalEvent({
      sourceId: a.id,
      title: "All day",
      timezone: "UTC",
      allDay: true,
      startDate: "2026-06-01",
      endDate: "2026-06-03",
    });
    const other = fx.service.createLocalEvent({
      sourceId: b.id,
      title: "Other",
      timezone: "UTC",
      allDay: false,
      startsAt: "2026-06-01T11:00:00Z",
      endsAt: "2026-06-01T12:00:00Z",
    });
    const listed = fx.service.listEvents({
      sourceIds: [a.id],
      startsAt: "2026-06-01T11:00:00Z",
      endsAt: "2026-06-01T11:30:00Z",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });
    expect(listed.map((item) => item.id)).toEqual([allDay.id, timed.id]);
    expect(listed.map((item) => item.id)).not.toContain(other.id);

    const updated = fx.service.updateLocalEvent({
      eventId: timed.id,
      sourceId: a.id,
      title: "Timed updated",
      timezone: "UTC",
      allDay: false,
      startsAt: "2026-06-01T10:30:00Z",
      endsAt: "2026-06-01T12:30:00Z",
    });
    expect(updated).toMatchObject({
      id: timed.id,
      sourceId: a.id,
      createdAt: timed.createdAt,
      title: "Timed updated",
    });
    expect(() =>
      fx.service.updateLocalEvent({
        eventId: timed.id,
        sourceId: b.id,
        title: "Cross source",
        timezone: "UTC",
        allDay: false,
        startsAt: "2026-06-01T10:30:00Z",
        endsAt: "2026-06-01T12:30:00Z",
      }),
    ).toThrow();
    fx.service.deleteLocalEvent(timed.id, a.id);
    fx.service.deleteLocalEvent(timed.id, a.id);
    expect(
      fx.service
        .listEvents({
          startsAt: "2026-06-01T10:00:00Z",
          endsAt: "2026-06-01T13:00:00Z",
          startDate: "2026-06-01",
          endDate: "2026-06-02",
        })
        .map((item) => item.id),
    ).toEqual([allDay.id, other.id]);
  });
});
