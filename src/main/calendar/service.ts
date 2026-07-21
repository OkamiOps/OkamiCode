import type { Database } from "../db/connection";

export type CalendarSourceKind =
  "local" | "google" | "outlook" | "caldav" | "ics";
export type CalendarSourceStatus =
  "active" | "not_configured" | "paused" | "degraded";
export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled";

export interface CalendarSource {
  id: string;
  kind: CalendarSourceKind;
  displayName: string;
  color: string;
  timezone: string;
  status: CalendarSourceStatus;
  syncCursor: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  id: string;
  sourceId: string;
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  organizer: string | null;
  joinUrl: string | null;
  sourceUrl: string | null;
  etag: string | null;
  providerUpdatedAt: string | null;
  attendees: string[];
  status: CalendarEventStatus;
  allDay: boolean;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocalSourceInput {
  displayName: string;
  color: string;
  timezone: string;
}

interface EventDetails {
  title: string;
  timezone: string;
  description?: string | null;
  location?: string | null;
  organizer?: string | null;
  joinUrl?: string | null;
  sourceUrl?: string | null;
  attendees?: string[];
  status?: CalendarEventStatus;
}

export type CreateLocalEventInput =
  | (EventDetails & {
      sourceId: string;
      allDay: false;
      startsAt: string;
      endsAt: string;
    })
  | (EventDetails & {
      sourceId: string;
      allDay: true;
      startDate: string;
      endDate: string;
    });

export interface UpdateLocalEventInput extends Partial<EventDetails> {
  eventId: string;
  sourceId: string;
  allDay?: boolean;
  startsAt?: string;
  endsAt?: string;
  startDate?: string;
  endDate?: string;
}

export interface ListEventsInput {
  sourceIds?: string[];
  startsAt?: string;
  endsAt?: string;
  startDate?: string;
  endDate?: string;
}

export type CalendarSyncUpsert =
  | (EventDetails & {
      externalId: string;
      providerUpdatedAt: string;
      etag?: string | null;
      allDay: false;
      startsAt: string;
      endsAt: string;
    })
  | (EventDetails & {
      externalId: string;
      providerUpdatedAt: string;
      etag?: string | null;
      allDay: true;
      startDate: string;
      endDate: string;
    });

export interface CalendarSyncTombstone {
  externalId: string;
  providerUpdatedAt: string;
}

export interface CalendarSyncBatchInput {
  sourceId: string;
  previousCursor: string | null;
  nextCursor: string;
  syncedAt: string;
  upserts: CalendarSyncUpsert[];
  tombstones: CalendarSyncTombstone[];
}

export interface CalendarSyncBatchCounts {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

export class CalendarSyncCursorConflictError extends Error {
  constructor() {
    super("Calendar sync cursor conflict");
    this.name = "CalendarSyncCursorConflictError";
  }
}

interface SourceRow {
  id: string;
  kind: CalendarSourceKind;
  display_name: string;
  color: string;
  timezone: string;
  status: CalendarSourceStatus;
  sync_cursor: string | null;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  source_id: string;
  external_id: string;
  title: string;
  description: string | null;
  location: string | null;
  organizer: string | null;
  join_url: string | null;
  source_url: string | null;
  etag: string | null;
  provider_updated_at: string | null;
  attendees_json: string;
  status: CalendarEventStatus;
  all_day: number;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class CalendarService {
  constructor(
    private readonly dependencies: {
      db: Database;
      createId: () => string;
      clock: () => string;
    },
  ) {}

  createLocalSource(input: CreateLocalSourceInput): CalendarSource {
    const displayName = requireText(input.displayName, "display name");
    if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
      throw new Error("Calendar color must be #RRGGBB");
    }
    const timezone = requireTimezone(input.timezone);
    const now = this.dependencies.clock();
    const source: CalendarSource = {
      id: this.dependencies.createId(),
      kind: "local",
      displayName,
      color: input.color.toUpperCase(),
      timezone,
      status: "active",
      syncCursor: null,
      lastError: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.dependencies.db
      .prepare(
        `INSERT INTO calendar_sources
         (id, kind, display_name, color, timezone, status, sync_cursor, last_error,
          last_synced_at, created_at, updated_at)
         VALUES (@id, @kind, @displayName, @color, @timezone, @status, @syncCursor,
                 @lastError, @lastSyncedAt, @createdAt, @updatedAt)`,
      )
      .run(source);
    return source;
  }

  listSources(): CalendarSource[] {
    return (
      this.dependencies.db
        .prepare("SELECT * FROM calendar_sources ORDER BY rowid ASC")
        .all() as SourceRow[]
    ).map(rowToSource);
  }

  createLocalEvent(input: CreateLocalEventInput): CalendarEvent {
    this.requireActiveLocalSource(input.sourceId);
    const id = this.dependencies.createId();
    const event = this.buildEvent({
      id,
      externalId: id,
      sourceId: input.sourceId,
      input,
    });
    this.insertEvent(event);
    return event;
  }

  updateLocalEvent(input: UpdateLocalEventInput): CalendarEvent {
    const current = this.requireMutableLocalEvent(
      input.eventId,
      input.sourceId,
    );
    const merged = mergeEventInput(current, input);
    const event = this.buildEvent({
      id: current.id,
      externalId: current.externalId,
      sourceId: current.sourceId,
      input: merged,
      createdAt: current.createdAt,
    });
    this.dependencies.db
      .prepare(
        `UPDATE calendar_events
         SET title = @title, description = @description, location = @location,
             organizer = @organizer, join_url = @joinUrl, source_url = @sourceUrl,
             attendees_json = @attendeesJson, status = @status, all_day = @allDay,
             timezone = @timezone, starts_at = @startsAt, ends_at = @endsAt,
             start_date = @startDate, end_date = @endDate, updated_at = @updatedAt
         WHERE id = @id AND source_id = @sourceId AND deleted_at IS NULL`,
      )
      .run(eventToParams(event));
    return event;
  }

  deleteLocalEvent(eventId: string, sourceId: string): void {
    const event = this.requireLocalEvent(eventId, sourceId);
    if (event.deletedAt !== null) {
      return;
    }
    const now = this.dependencies.clock();
    this.dependencies.db
      .prepare(
        "UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND source_id = ?",
      )
      .run(now, now, eventId, sourceId);
  }

  listEvents(input: ListEventsInput = {}): CalendarEvent[] {
    validateWindow(input.startsAt, input.endsAt, "timed");
    validateWindow(input.startDate, input.endDate, "all-day");
    if (input.sourceIds?.length === 0) {
      return [];
    }

    const clauses = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (input.sourceIds) {
      clauses.push(
        `source_id IN (${input.sourceIds.map(() => "?").join(", ")})`,
      );
      params.push(...input.sourceIds);
    }
    const eventClauses: string[] = [];
    if (input.startsAt && input.endsAt) {
      const startsAt = canonicalInstant(input.startsAt);
      const endsAt = canonicalInstant(input.endsAt);
      if (endsAt <= startsAt) {
        throw new Error("Timed window end must be after start");
      }
      eventClauses.push("(all_day = 0 AND starts_at < ? AND ends_at > ?)");
      params.push(endsAt, startsAt);
    } else {
      eventClauses.push("all_day = 0");
    }
    if (input.startDate && input.endDate) {
      requireDateRange(input.startDate, input.endDate);
      eventClauses.push("(all_day = 1 AND start_date < ? AND end_date > ?)");
      params.push(input.endDate, input.startDate);
    } else {
      eventClauses.push("all_day = 1");
    }
    clauses.push(`(${eventClauses.join(" OR ")})`);
    const rows = this.dependencies.db
      .prepare(
        `SELECT * FROM calendar_events WHERE ${clauses.join(" AND ")}
         ORDER BY CASE WHEN all_day = 1 THEN start_date || 'T00:00:00.000Z' ELSE starts_at END ASC,
                  id ASC`,
      )
      .all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }

  applySyncBatch(input: CalendarSyncBatchInput): CalendarSyncBatchCounts {
    const sourceId = requireText(input.sourceId, "source id");
    const previousCursor = requireCursor(input.previousCursor, "previous");
    const nextCursor = requireCursor(input.nextCursor, "next");
    const syncedAt = canonicalInstant(input.syncedAt);
    const source = this.findSource(sourceId);
    if (
      !source ||
      source.kind === "local" ||
      (source.status !== "active" && source.status !== "degraded")
    ) {
      throw new Error("Calendar source is not available for synchronization");
    }

    const seen = new Set<string>();
    const upserts = input.upserts.map((upsert) => {
      const externalId = requireExternalId(upsert.externalId, seen);
      const providerUpdatedAt = canonicalInstant(upsert.providerUpdatedAt);
      const event = this.buildEvent({
        id: "calendar-sync-validation",
        externalId,
        sourceId,
        input: syncUpsertToEventInput(upsert, sourceId),
        createdAt: syncedAt,
      });
      return {
        externalId,
        providerUpdatedAt,
        etag: optionalText(upsert.etag),
        event,
      };
    });
    const tombstones = input.tombstones.map((tombstone) => ({
      externalId: requireExternalId(tombstone.externalId, seen),
      providerUpdatedAt: canonicalInstant(tombstone.providerUpdatedAt),
    }));

    return this.dependencies.db.transaction(() => {
      const persistedSource = this.findSource(sourceId);
      if (
        !persistedSource ||
        persistedSource.kind === "local" ||
        (persistedSource.status !== "active" &&
          persistedSource.status !== "degraded")
      ) {
        throw new Error("Calendar source is not available for synchronization");
      }
      if (persistedSource.syncCursor !== previousCursor) {
        throw new CalendarSyncCursorConflictError();
      }
      const counts: CalendarSyncBatchCounts = {
        inserted: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
      };
      for (const upsert of upserts.sort(compareExternalId)) {
        const current = this.findEventByExternalId(sourceId, upsert.externalId);
        if (
          current &&
          !isNewerVersion(upsert.providerUpdatedAt, current.providerUpdatedAt)
        ) {
          counts.unchanged += 1;
          continue;
        }
        if (!current) {
          this.insertEvent(
            this.buildSyncedEvent({
              id: this.dependencies.createId(),
              sourceId,
              externalId: upsert.externalId,
              event: upsert.event,
              etag: upsert.etag,
              providerUpdatedAt: upsert.providerUpdatedAt,
              syncedAt,
            }),
          );
          counts.inserted += 1;
          continue;
        }
        this.updateSyncedEvent(
          current,
          upsert.event,
          upsert.etag,
          upsert.providerUpdatedAt,
          syncedAt,
        );
        counts.updated += 1;
      }
      for (const tombstone of tombstones.sort(compareExternalId)) {
        const current = this.findEventByExternalId(
          sourceId,
          tombstone.externalId,
        );
        if (
          current &&
          !isNewerVersion(
            tombstone.providerUpdatedAt,
            current.providerUpdatedAt,
          )
        ) {
          counts.unchanged += 1;
          continue;
        }
        if (!current) {
          this.insertEvent({
            id: this.dependencies.createId(),
            sourceId,
            externalId: tombstone.externalId,
            title: "Deleted remote event",
            description: null,
            location: null,
            organizer: null,
            joinUrl: null,
            sourceUrl: null,
            etag: null,
            providerUpdatedAt: tombstone.providerUpdatedAt,
            attendees: [],
            status: "cancelled",
            allDay: true,
            timezone: "UTC",
            startsAt: null,
            endsAt: null,
            startDate: "1970-01-01",
            endDate: "1970-01-02",
            deletedAt: syncedAt,
            createdAt: syncedAt,
            updatedAt: syncedAt,
          });
        } else {
          this.dependencies.db
            .prepare(
              `UPDATE calendar_events
               SET deleted_at = ?, provider_updated_at = ?, updated_at = ?
               WHERE id = ? AND source_id = ?`,
            )
            .run(
              syncedAt,
              tombstone.providerUpdatedAt,
              syncedAt,
              current.id,
              sourceId,
            );
        }
        counts.deleted += 1;
      }
      this.dependencies.db
        .prepare(
          `UPDATE calendar_sources
           SET sync_cursor = ?, last_synced_at = ?, last_error = NULL,
               status = 'active', updated_at = ?
           WHERE id = ?`,
        )
        .run(nextCursor, syncedAt, syncedAt, sourceId);
      return counts;
    })();
  }

  private buildEvent({
    id,
    externalId,
    sourceId,
    input,
    createdAt = this.dependencies.clock(),
  }: {
    id: string;
    externalId: string;
    sourceId: string;
    input: CreateLocalEventInput;
    createdAt?: string;
  }): CalendarEvent {
    const title = requireText(input.title, "event title");
    const timezone = requireTimezone(input.timezone);
    const now = this.dependencies.clock();
    const base = {
      id,
      sourceId,
      externalId,
      title,
      description: optionalText(input.description),
      location: optionalText(input.location),
      organizer: optionalText(input.organizer),
      joinUrl: optionalText(input.joinUrl),
      sourceUrl: optionalText(input.sourceUrl),
      etag: null,
      providerUpdatedAt: null,
      attendees: canonicalAttendees(input.attendees ?? []),
      status: requireEventStatus(input.status ?? "confirmed"),
      timezone,
      deletedAt: null,
      createdAt,
      updatedAt: now,
    };
    if (input.allDay) {
      requireDateRange(input.startDate, input.endDate);
      return {
        ...base,
        allDay: true,
        startsAt: null,
        endsAt: null,
        startDate: input.startDate,
        endDate: input.endDate,
      };
    }
    const startsAt = canonicalInstant(input.startsAt);
    const endsAt = canonicalInstant(input.endsAt);
    if (endsAt <= startsAt) {
      throw new Error("Timed event end must be after start");
    }
    return {
      ...base,
      allDay: false,
      startsAt,
      endsAt,
      startDate: null,
      endDate: null,
    };
  }

  private insertEvent(event: CalendarEvent): void {
    this.dependencies.db
      .prepare(
        `INSERT INTO calendar_events
         (id, source_id, external_id, title, description, location, organizer, join_url,
          source_url, etag, provider_updated_at, attendees_json, status, all_day, timezone,
          starts_at, ends_at, start_date, end_date, deleted_at, created_at, updated_at)
         VALUES (@id, @sourceId, @externalId, @title, @description, @location, @organizer,
                 @joinUrl, @sourceUrl, @etag, @providerUpdatedAt, @attendeesJson, @status,
                 @allDay, @timezone, @startsAt, @endsAt, @startDate, @endDate, @deletedAt,
                 @createdAt, @updatedAt)`,
      )
      .run(eventToParams(event));
  }

  private buildSyncedEvent({
    id,
    sourceId,
    externalId,
    event,
    etag,
    providerUpdatedAt,
    syncedAt,
  }: {
    id: string;
    sourceId: string;
    externalId: string;
    event: CalendarEvent;
    etag: string | null;
    providerUpdatedAt: string;
    syncedAt: string;
  }): CalendarEvent {
    return {
      ...event,
      id,
      sourceId,
      externalId,
      etag,
      providerUpdatedAt,
      deletedAt: null,
      createdAt: syncedAt,
      updatedAt: syncedAt,
    };
  }

  private updateSyncedEvent(
    current: CalendarEvent,
    event: CalendarEvent,
    etag: string | null,
    providerUpdatedAt: string,
    syncedAt: string,
  ): void {
    this.dependencies.db
      .prepare(
        `UPDATE calendar_events
         SET title = @title, description = @description, location = @location,
             organizer = @organizer, join_url = @joinUrl, source_url = @sourceUrl,
             etag = @etag, provider_updated_at = @providerUpdatedAt,
             attendees_json = @attendeesJson, status = @status, all_day = @allDay,
             timezone = @timezone, starts_at = @startsAt, ends_at = @endsAt,
             start_date = @startDate, end_date = @endDate, deleted_at = NULL,
             updated_at = @updatedAt
         WHERE id = @id AND source_id = @sourceId`,
      )
      .run(
        eventToParams({
          ...event,
          id: current.id,
          sourceId: current.sourceId,
          externalId: current.externalId,
          etag,
          providerUpdatedAt,
          createdAt: current.createdAt,
          updatedAt: syncedAt,
          deletedAt: null,
        }),
      );
  }

  private findEventByExternalId(
    sourceId: string,
    externalId: string,
  ): CalendarEvent | undefined {
    const row = this.dependencies.db
      .prepare(
        "SELECT * FROM calendar_events WHERE source_id = ? AND external_id = ?",
      )
      .get(sourceId, externalId) as EventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  }

  private requireActiveLocalSource(sourceId: string): CalendarSource {
    const source = this.findSource(sourceId);
    if (!source || source.kind !== "local" || source.status !== "active") {
      throw new Error("Calendar source must be local and active");
    }
    return source;
  }

  private requireLocalEvent(eventId: string, sourceId: string): CalendarEvent {
    const event = this.dependencies.db
      .prepare("SELECT * FROM calendar_events WHERE id = ? AND source_id = ?")
      .get(eventId, sourceId) as EventRow | undefined;
    if (!event) {
      throw new Error("Calendar event was not found for this source");
    }
    this.requireActiveLocalSource(sourceId);
    return rowToEvent(event);
  }

  private requireMutableLocalEvent(
    eventId: string,
    sourceId: string,
  ): CalendarEvent {
    const event = this.requireLocalEvent(eventId, sourceId);
    if (event.deletedAt !== null) {
      throw new Error("Deleted calendar events cannot be updated");
    }
    return event;
  }

  private findSource(sourceId: string): CalendarSource | undefined {
    const row = this.dependencies.db
      .prepare("SELECT * FROM calendar_sources WHERE id = ?")
      .get(sourceId) as SourceRow | undefined;
    return row ? rowToSource(row) : undefined;
  }
}

function mergeEventInput(
  current: CalendarEvent,
  update: UpdateLocalEventInput,
): CreateLocalEventInput {
  const details: EventDetails = {
    title: update.title ?? current.title,
    timezone: update.timezone ?? current.timezone,
    description:
      update.description === undefined
        ? current.description
        : update.description,
    location:
      update.location === undefined ? current.location : update.location,
    organizer:
      update.organizer === undefined ? current.organizer : update.organizer,
    joinUrl: update.joinUrl === undefined ? current.joinUrl : update.joinUrl,
    sourceUrl:
      update.sourceUrl === undefined ? current.sourceUrl : update.sourceUrl,
    attendees: update.attendees ?? current.attendees,
    status: update.status ?? current.status,
  };
  const allDay = update.allDay ?? current.allDay;
  if (allDay) {
    return {
      ...details,
      sourceId: current.sourceId,
      allDay: true,
      startDate: update.startDate ?? current.startDate ?? "",
      endDate: update.endDate ?? current.endDate ?? "",
    };
  }
  return {
    ...details,
    sourceId: current.sourceId,
    allDay: false,
    startsAt: update.startsAt ?? current.startsAt ?? "",
    endsAt: update.endsAt ?? current.endsAt ?? "",
  };
}

function eventToParams(event: CalendarEvent) {
  return {
    ...event,
    attendeesJson: JSON.stringify(event.attendees),
    allDay: event.allDay ? 1 : 0,
  };
}

function rowToSource(row: SourceRow): CalendarSource {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    color: row.color,
    timezone: row.timezone,
    status: row.status,
    syncCursor: row.sync_cursor,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEvent(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalId: row.external_id,
    title: row.title,
    description: row.description,
    location: row.location,
    organizer: row.organizer,
    joinUrl: row.join_url,
    sourceUrl: row.source_url,
    etag: row.etag,
    providerUpdatedAt: row.provider_updated_at,
    attendees: JSON.parse(row.attendees_json) as string[],
    status: row.status,
    allDay: row.all_day === 1,
    timezone: row.timezone,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startDate: row.start_date,
    endDate: row.end_date,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Calendar ${label} is required`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function requireEventStatus(value: CalendarEventStatus): CalendarEventStatus {
  if (!(["confirmed", "tentative", "cancelled"] as const).includes(value)) {
    throw new Error("Calendar event status is invalid");
  }
  return value;
}

function requireCursor(value: string | null, label: string): string | null {
  if (value === null) {
    return null;
  }
  return requireText(value, `${label} sync cursor`);
}

function requireExternalId(externalId: string, seen: Set<string>): string {
  const normalized = requireText(externalId, "external id");
  if (seen.has(normalized)) {
    throw new Error("Calendar sync batch contains duplicate external ids");
  }
  seen.add(normalized);
  return normalized;
}

function syncUpsertToEventInput(
  upsert: CalendarSyncUpsert,
  sourceId: string,
): CreateLocalEventInput {
  if (upsert.allDay) {
    return {
      sourceId,
      allDay: true,
      title: upsert.title,
      timezone: upsert.timezone,
      description: upsert.description,
      location: upsert.location,
      organizer: upsert.organizer,
      joinUrl: upsert.joinUrl,
      sourceUrl: upsert.sourceUrl,
      attendees: upsert.attendees,
      status: upsert.status,
      startDate: upsert.startDate,
      endDate: upsert.endDate,
    };
  }
  return {
    sourceId,
    allDay: false,
    title: upsert.title,
    timezone: upsert.timezone,
    description: upsert.description,
    location: upsert.location,
    organizer: upsert.organizer,
    joinUrl: upsert.joinUrl,
    sourceUrl: upsert.sourceUrl,
    attendees: upsert.attendees,
    status: upsert.status,
    startsAt: upsert.startsAt,
    endsAt: upsert.endsAt,
  };
}

function isNewerVersion(incoming: string, stored: string | null): boolean {
  return stored === null || incoming > stored;
}

function compareExternalId(
  left: { externalId: string },
  right: { externalId: string },
): number {
  if (left.externalId < right.externalId) {
    return -1;
  }
  if (left.externalId > right.externalId) {
    return 1;
  }
  return 0;
}

function requireTimezone(value: string): string {
  const timezone = requireText(value, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error("Calendar timezone must be a valid IANA timezone");
  }
  return timezone;
}

function canonicalAttendees(attendees: string[]): string[] {
  return [
    ...new Set(
      attendees.map((item) => requireText(item, "attendee").toLowerCase()),
    ),
  ].sort();
}

function canonicalInstant(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) {
    throw new Error("Timed calendar datetimes require an explicit offset");
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");
  const offsetHour = Number(offsetHourText ?? "0");
  const offsetMinute = Number(offsetMinuteText ?? "0");
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new Error("Timed calendar datetime is invalid");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Timed calendar datetime is invalid");
  }
  return date.toISOString();
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function requireDateRange(startDate: string, endDate: string): void {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate <= startDate) {
    throw new Error(
      "All-day calendar events require an exclusive valid date range",
    );
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validateWindow(
  start: string | undefined,
  end: string | undefined,
  label: string,
): void {
  if ((start === undefined) !== (end === undefined)) {
    throw new Error(`${label} calendar window requires both boundaries`);
  }
}
