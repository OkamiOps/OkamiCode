import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../db/test-support";
import { CalendarService, CalendarSyncCursorConflictError } from "./service";

function createService() {
  const fx = createTestDatabase();
  let id = 0;
  let tick = 0;
  const createId = vi.fn(() => `calendar-${++id}`);
  return {
    ...fx,
    createId,
    service: new CalendarService({
      db: fx.db,
      createId,
      clock: () => `2026-07-21T00:00:${String(++tick).padStart(2, "0")}.000Z`,
    }),
  };
}

function createRemoteSource(
  fx: ReturnType<typeof createService>,
  overrides: Partial<{
    id: string;
    kind: "google" | "outlook" | "caldav" | "ics";
    status: "active" | "not_configured" | "paused" | "degraded";
    syncCursor: string | null;
  }> = {},
) {
  const source = {
    id: overrides.id ?? "remote-source",
    kind: overrides.kind ?? "google",
    status: overrides.status ?? "active",
    syncCursor: overrides.syncCursor ?? null,
  };
  fx.db
    .prepare(
      `INSERT INTO calendar_sources
       (id, kind, display_name, color, timezone, status, sync_cursor, last_error,
        last_synced_at, created_at, updated_at)
       VALUES (?, ?, 'Remote', '#112233', 'UTC', ?, ?, 'previous error', NULL,
               '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z')`,
    )
    .run(source.id, source.kind, source.status, source.syncCursor);
  return source;
}

function timedUpsert(
  externalId: string,
  providerUpdatedAt = "2026-07-21T10:00:00Z",
) {
  return {
    externalId,
    providerUpdatedAt,
    title: `Event ${externalId}`,
    timezone: "UTC",
    allDay: false as const,
    startsAt: "2026-08-01T10:00:00Z",
    endsAt: "2026-08-01T11:00:00Z",
  };
}

function syncInput(sourceId: string, overrides = {}) {
  return {
    sourceId,
    previousCursor: null,
    nextCursor: "cursor-1",
    syncedAt: "2026-07-21T12:00:00Z",
    upserts: [],
    tombstones: [],
    ...overrides,
  };
}

describe("CalendarService", () => {
  it("creates local sources and rejects invalid input", () => {
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
  });

  it("preserves true insertion order when timestamps tie and ids sort backwards", () => {
    const fx = createTestDatabase();
    const ids = ["z-source", "a-source"];
    const service = new CalendarService({
      db: fx.db,
      createId: () => ids.shift() ?? "unexpected",
      clock: () => "2026-07-21T00:00:00.000Z",
    });
    const first = service.createLocalSource({
      displayName: "Inserted first",
      color: "#111111",
      timezone: "UTC",
    });
    const second = service.createLocalSource({
      displayName: "Inserted second",
      color: "#222222",
      timezone: "UTC",
    });

    expect(service.listSources()).toEqual([first, second]);
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
        title: "Impossible civil date",
        timezone: "America/New_York",
        allDay: false,
        startsAt: "2026-02-30T10:00:00-05:00",
        endsAt: "2026-03-03T11:00:00-05:00",
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

  it("rejects credential-bearing URLs before local or provider events can be persisted", () => {
    const fx = createService();
    const local = fx.service.createLocalSource({
      displayName: "Seguro",
      color: "#123456",
      timezone: "UTC",
    });

    expect(() =>
      fx.service.createLocalEvent({
        sourceId: local.id,
        title: "Credencial em userinfo",
        timezone: "UTC",
        allDay: false,
        startsAt: "2026-06-01T10:00:00Z",
        endsAt: "2026-06-01T11:00:00Z",
        joinUrl: "https://user:password@meet.example/event",
      }),
    ).toThrow("Calendar URL must not contain credentials");
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM calendar_events").get(),
    ).toEqual({ count: 0 });

    const remote = createRemoteSource(fx);
    expect(() =>
      fx.service.applySyncBatch(
        syncInput(remote.id, {
          upserts: [
            {
              ...timedUpsert("remote-secret"),
              sourceUrl:
                "https://calendar.example/event?access_token=never-store-this",
            },
          ],
        }),
      ),
    ).toThrow("Calendar URL must not contain credentials");
    expect(
      fx.db
        .prepare("SELECT sync_cursor FROM calendar_sources WHERE id = ?")
        .get(remote.id),
    ).toEqual({ sync_cursor: null });
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM calendar_events").get(),
    ).toEqual({ count: 0 });

    expect(
      fx.service.createLocalEvent({
        sourceId: local.id,
        title: "Link público",
        timezone: "UTC",
        allDay: false,
        startsAt: "2026-06-01T12:00:00Z",
        endsAt: "2026-06-01T13:00:00Z",
        joinUrl: "https://meet.example/event?view=compact",
      }).joinUrl,
    ).toBe("https://meet.example/event?view=compact");
  });

  it("preserves undefined nullable fields and clears every nullable local field with null", () => {
    const fx = createService();
    const source = fx.service.createLocalSource({
      displayName: "Mutable",
      color: "#123456",
      timezone: "UTC",
    });
    const event = fx.service.createLocalEvent({
      sourceId: source.id,
      title: "Original",
      timezone: "UTC",
      allDay: false,
      startsAt: "2026-06-01T10:00:00Z",
      endsAt: "2026-06-01T11:00:00Z",
      description: "Description",
      location: "Room",
      organizer: "organizer@example.com",
      joinUrl: "https://meet.example.com/event",
      sourceUrl: "https://calendar.example.com/event",
    });

    const preserved = fx.service.updateLocalEvent({
      eventId: event.id,
      sourceId: source.id,
      title: "Renamed",
    });
    expect(preserved).toMatchObject({
      description: "Description",
      location: "Room",
      organizer: "organizer@example.com",
      joinUrl: "https://meet.example.com/event",
      sourceUrl: "https://calendar.example.com/event",
    });

    const cleared = fx.service.updateLocalEvent({
      eventId: event.id,
      sourceId: source.id,
      description: null,
      location: null,
      organizer: null,
      joinUrl: null,
      sourceUrl: null,
    });
    expect(cleared).toMatchObject({
      description: null,
      location: null,
      organizer: null,
      joinUrl: null,
      sourceUrl: null,
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
    const deletedOnce = fx.db
      .prepare(
        "SELECT deleted_at, updated_at FROM calendar_events WHERE id = ?",
      )
      .get(timed.id) as { deleted_at: string; updated_at: string };
    expect(deletedOnce.deleted_at).toBe(deletedOnce.updated_at);
    fx.service.deleteLocalEvent(timed.id, a.id);
    expect(
      fx.db
        .prepare(
          "SELECT deleted_at, updated_at FROM calendar_events WHERE id = ?",
        )
        .get(timed.id),
    ).toEqual(deletedOnce);
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

  it("rejects a cursor conflict and an invalid later item without mutating the source or events", () => {
    const fx = createService();
    const source = createRemoteSource(fx, { syncCursor: "cursor-0" });

    expect(() =>
      fx.service.applySyncBatch(
        syncInput(source.id, {
          previousCursor: "wrong-cursor",
          upserts: [timedUpsert("first")],
        }),
      ),
    ).toThrow(CalendarSyncCursorConflictError);
    expect(
      fx.db
        .prepare("SELECT sync_cursor FROM calendar_sources WHERE id = ?")
        .get(source.id),
    ).toEqual({ sync_cursor: "cursor-0" });
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM calendar_events").get(),
    ).toEqual({ count: 0 });

    expect(() =>
      fx.service.applySyncBatch(
        syncInput(source.id, {
          previousCursor: "cursor-0",
          upserts: [
            timedUpsert("valid"),
            { ...timedUpsert("invalid"), title: " " },
          ],
        }),
      ),
    ).toThrow("Calendar event title is required");
    expect(
      fx.db
        .prepare("SELECT sync_cursor FROM calendar_sources WHERE id = ?")
        .get(source.id),
    ).toEqual({ sync_cursor: "cursor-0" });
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM calendar_events").get(),
    ).toEqual({ count: 0 });
  });

  it("validates every provider event before generating ids or entering the mutating phase", () => {
    const fx = createService();
    const source = createRemoteSource(fx);

    expect(() =>
      fx.service.applySyncBatch(
        syncInput(source.id, {
          upserts: [
            timedUpsert("a-valid"),
            {
              ...timedUpsert("z-invalid"),
              status: "provider-made-this-up",
            },
          ],
        }) as Parameters<typeof fx.service.applySyncBatch>[0],
      ),
    ).toThrow("Calendar event status is invalid");
    expect(fx.createId).not.toHaveBeenCalled();
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM calendar_events").get(),
    ).toEqual({ count: 0 });
  });

  it("rolls back earlier event writes and cursor metadata when SQLite rejects a later write", () => {
    const fx = createService();
    const source = createRemoteSource(fx);
    fx.db.exec(`
      CREATE TRIGGER reject_calendar_sync_insert
      BEFORE INSERT ON calendar_events
      WHEN NEW.external_id = 'z-rejected'
      BEGIN
        SELECT RAISE(ABORT, 'forced calendar write failure');
      END;
    `);

    expect(() =>
      fx.service.applySyncBatch(
        syncInput(source.id, {
          upserts: [timedUpsert("a-written-first"), timedUpsert("z-rejected")],
        }),
      ),
    ).toThrow("forced calendar write failure");
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM calendar_events").get(),
    ).toEqual({ count: 0 });
    expect(
      fx.db
        .prepare(
          "SELECT sync_cursor, last_synced_at, last_error FROM calendar_sources WHERE id = ?",
        )
        .get(source.id),
    ).toEqual({
      sync_cursor: null,
      last_synced_at: null,
      last_error: "previous error",
    });
  });

  it("assigns stable local identities independently of provider array order", () => {
    const forward = createService();
    const reverse = createService();
    const forwardSource = createRemoteSource(forward);
    const reverseSource = createRemoteSource(reverse);
    const composed = timedUpsert("\u00e9");
    const decomposed = timedUpsert("e\u0301");

    forward.service.applySyncBatch(
      syncInput(forwardSource.id, { upserts: [composed, decomposed] }),
    );
    reverse.service.applySyncBatch(
      syncInput(reverseSource.id, { upserts: [decomposed, composed] }),
    );

    const mapping = (fx: ReturnType<typeof createService>) =>
      fx.db
        .prepare(
          "SELECT external_id, id FROM calendar_events ORDER BY external_id ASC",
        )
        .all();
    expect(mapping(reverse)).toEqual(mapping(forward));
  });

  it("revalidates remote source eligibility inside the transaction before event writes", () => {
    const fx = createService();
    const source = createRemoteSource(fx);
    let pauseBeforeTransaction = true;
    const service = new CalendarService({
      db: fx.db,
      createId: fx.createId,
      clock: () => {
        if (pauseBeforeTransaction) {
          pauseBeforeTransaction = false;
          fx.db
            .prepare(
              "UPDATE calendar_sources SET status = 'paused' WHERE id = ?",
            )
            .run(source.id);
        }
        return "2026-07-21T12:00:00.000Z";
      },
    });

    expect(() =>
      service.applySyncBatch(
        syncInput(source.id, { upserts: [timedUpsert("must-not-write")] }),
      ),
    ).toThrow("Calendar source is not available for synchronization");
    expect(fx.createId).not.toHaveBeenCalled();
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM calendar_events").get(),
    ).toEqual({ count: 0 });
    expect(
      fx.db
        .prepare(
          "SELECT status, sync_cursor, last_synced_at, last_error FROM calendar_sources WHERE id = ?",
        )
        .get(source.id),
    ).toEqual({
      status: "paused",
      sync_cursor: null,
      last_synced_at: null,
      last_error: "previous error",
    });
  });

  it("upserts only newer provider versions and preserves the local event identity", () => {
    const fx = createService();
    const source = createRemoteSource(fx);

    expect(
      fx.service.applySyncBatch(
        syncInput(source.id, { upserts: [timedUpsert("provider-1")] }),
      ),
    ).toEqual({ inserted: 1, updated: 0, deleted: 0, unchanged: 0 });
    const inserted = fx.db
      .prepare(
        "SELECT id, created_at FROM calendar_events WHERE external_id = ?",
      )
      .get("provider-1") as { id: string; created_at: string };

    expect(
      fx.service.applySyncBatch(
        syncInput(source.id, {
          previousCursor: "cursor-1",
          nextCursor: "cursor-2",
          upserts: [
            {
              ...timedUpsert("provider-1", "2026-07-21T11:00:00Z"),
              title: "Updated remotely",
            },
          ],
        }),
      ),
    ).toEqual({ inserted: 0, updated: 1, deleted: 0, unchanged: 0 });
    expect(
      fx.db
        .prepare(
          "SELECT id, created_at, title, provider_updated_at FROM calendar_events WHERE external_id = ?",
        )
        .get("provider-1"),
    ).toEqual({
      id: inserted.id,
      created_at: inserted.created_at,
      title: "Updated remotely",
      provider_updated_at: "2026-07-21T11:00:00.000Z",
    });
    expect(
      fx.service.applySyncBatch(
        syncInput(source.id, {
          previousCursor: "cursor-2",
          nextCursor: "cursor-3",
          upserts: [timedUpsert("provider-1", "2026-07-21T11:00:00Z")],
        }),
      ),
    ).toEqual({ inserted: 0, updated: 0, deleted: 0, unchanged: 1 });
  });

  it("applies tombstones by provider version and blocks stale resurrection, including unseen events", () => {
    const fx = createService();
    const source = createRemoteSource(fx);
    fx.service.applySyncBatch(
      syncInput(source.id, { upserts: [timedUpsert("provider-1")] }),
    );

    expect(
      fx.service.applySyncBatch(
        syncInput(source.id, {
          previousCursor: "cursor-1",
          nextCursor: "cursor-2",
          tombstones: [
            {
              externalId: "provider-1",
              providerUpdatedAt: "2026-07-21T11:00:00Z",
            },
            { externalId: "unseen", providerUpdatedAt: "2026-07-21T12:00:00Z" },
          ],
        }),
      ),
    ).toEqual({ inserted: 0, updated: 0, deleted: 2, unchanged: 0 });
    expect(
      fx.service.applySyncBatch(
        syncInput(source.id, {
          previousCursor: "cursor-2",
          nextCursor: "cursor-3",
          upserts: [
            timedUpsert("provider-1", "2026-07-21T11:00:00Z"),
            timedUpsert("unseen", "2026-07-21T11:00:00Z"),
          ],
        }),
      ),
    ).toEqual({ inserted: 0, updated: 0, deleted: 0, unchanged: 2 });
    expect(
      fx.service.applySyncBatch(
        syncInput(source.id, {
          previousCursor: "cursor-3",
          nextCursor: "cursor-4",
          upserts: [timedUpsert("provider-1", "2026-07-21T13:00:00Z")],
        }),
      ),
    ).toEqual({ inserted: 0, updated: 1, deleted: 0, unchanged: 0 });
    expect(fx.service.listEvents().map((event) => event.externalId)).toEqual([
      "provider-1",
    ]);
  });

  it("rejects ineligible sources and duplicate external ids before mutating, while recovering a degraded remote source", () => {
    const fx = createService();
    const local = fx.service.createLocalSource({
      displayName: "Local",
      color: "#112233",
      timezone: "UTC",
    });
    const notConfigured = createRemoteSource(fx, {
      id: "not-configured",
      status: "not_configured",
    });
    const paused = createRemoteSource(fx, { id: "paused", status: "paused" });
    for (const source of [local, notConfigured, paused]) {
      expect(() =>
        fx.service.applySyncBatch(
          syncInput(source.id, { upserts: [timedUpsert("rejected")] }),
        ),
      ).toThrow();
    }

    const degraded = createRemoteSource(fx, {
      id: "degraded",
      status: "degraded",
    });
    expect(() =>
      fx.service.applySyncBatch(
        syncInput(degraded.id, {
          upserts: [timedUpsert("duplicate"), timedUpsert("duplicate")],
        }),
      ),
    ).toThrow();
    expect(
      fx.db
        .prepare(
          "SELECT status, sync_cursor FROM calendar_sources WHERE id = ?",
        )
        .get(degraded.id),
    ).toEqual({ status: "degraded", sync_cursor: null });
    expect(() =>
      fx.service.applySyncBatch(
        syncInput(degraded.id, {
          upserts: [timedUpsert("shared")],
          tombstones: [
            { externalId: "shared", providerUpdatedAt: "2026-07-21T10:00:00Z" },
          ],
        }),
      ),
    ).toThrow();

    expect(
      fx.service.applySyncBatch(
        syncInput(degraded.id, { upserts: [timedUpsert("accepted")] }),
      ),
    ).toEqual({ inserted: 1, updated: 0, deleted: 0, unchanged: 0 });
    expect(
      fx.db
        .prepare(
          "SELECT status, sync_cursor, last_error, last_synced_at, updated_at FROM calendar_sources WHERE id = ?",
        )
        .get(degraded.id),
    ).toEqual({
      status: "active",
      sync_cursor: "cursor-1",
      last_error: null,
      last_synced_at: "2026-07-21T12:00:00.000Z",
      updated_at: "2026-07-21T12:00:00.000Z",
    });
  });
});
