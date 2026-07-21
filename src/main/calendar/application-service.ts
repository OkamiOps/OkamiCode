import type { Database } from "../db/connection";
import { isSafeCalendarHttpUrl } from "../../shared/contracts/calendar-url";
import {
  RemoteCalendarError,
  type LinkedCalendarProtocol,
  type RemoteCalendarSynchronizer,
} from "./remote-adapter";
import {
  CalendarService,
  type CalendarEvent,
  type CalendarSource,
  type CreateLocalEventInput,
  type CreateLocalSourceInput,
  type ListEventsInput,
  type UpdateLocalEventInput,
} from "./service";

export interface CreateLinkedSourceInput {
  accountId: string;
  protocol: LinkedCalendarProtocol;
  calendarUrl: string;
  displayName: string;
  color: string;
  timezone: string;
}

interface LinkedSourceRow {
  source_id: string;
  account_id: string;
  protocol: LinkedCalendarProtocol;
  calendar_url: string;
}

export class CalendarApplicationService {
  private readonly syncTtlMs: number;

  constructor(
    private readonly dependencies: {
      db: Database;
      calendar: CalendarService;
      synchronizer: RemoteCalendarSynchronizer;
      createId: () => string;
      clock: () => Date;
      syncTtlMs?: number;
    },
  ) {
    this.syncTtlMs = dependencies.syncTtlMs ?? 5 * 60 * 1000;
  }

  listSources(): CalendarSource[] {
    return this.dependencies.calendar.listSources();
  }

  createLocalSource(input: CreateLocalSourceInput): CalendarSource {
    return this.dependencies.calendar.createLocalSource(input);
  }

  async createLinkedSource(
    input: CreateLinkedSourceInput,
  ): Promise<CalendarSource> {
    this.requireAccount(input.accountId);
    if (!isSafeCalendarHttpUrl(input.calendarUrl)) {
      throw new Error(
        "Calendar URL must be public HTTP(S) without credentials",
      );
    }
    const displayName = requiredText(input.displayName, "display name");
    const timezone = requiredText(input.timezone, "timezone");
    if (!/^#[0-9A-Fa-f]{6}$/u.test(input.color)) {
      throw new Error("Calendar color must be #RRGGBB");
    }
    const now = this.dependencies.clock().toISOString();
    const sourceId = this.dependencies.createId();
    this.dependencies.db.transaction(() => {
      this.dependencies.db
        .prepare(
          `INSERT INTO calendar_sources
           (id, kind, display_name, color, timezone, status, sync_cursor,
            last_error, last_synced_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          sourceId,
          input.protocol,
          displayName,
          input.color.toUpperCase(),
          timezone,
          now,
          now,
        );
      this.dependencies.db
        .prepare(
          `INSERT INTO calendar_linked_sources
           (source_id, account_id, protocol, calendar_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceId,
          input.accountId,
          input.protocol,
          input.calendarUrl,
          now,
          now,
        );
    })();
    await this.synchronizeSource(sourceId);
    return this.requireSource(sourceId);
  }

  async listEvents(input: ListEventsInput = {}): Promise<CalendarEvent[]> {
    const mappings = this.linkedSources(input.sourceIds);
    await Promise.all(
      mappings
        .filter((mapping) => this.isSyncDue(mapping.source_id))
        .map((mapping) => this.synchronizeSource(mapping.source_id)),
    );
    return this.dependencies.calendar.listEvents(input);
  }

  createLocalEvent(input: CreateLocalEventInput): CalendarEvent {
    return this.dependencies.calendar.createLocalEvent(input);
  }

  updateLocalEvent(input: UpdateLocalEventInput): CalendarEvent {
    return this.dependencies.calendar.updateLocalEvent(input);
  }

  deleteLocalEvent(eventId: string, sourceId: string): void {
    this.dependencies.calendar.deleteLocalEvent(eventId, sourceId);
  }

  private async synchronizeSource(sourceId: string): Promise<void> {
    const mapping = this.linkedSources([sourceId])[0];
    if (!mapping) return;
    const source = this.requireSource(sourceId);
    try {
      const snapshot = await this.dependencies.synchronizer.synchronize({
        source,
        accountId: mapping.account_id,
        protocol: mapping.protocol,
        calendarUrl: mapping.calendar_url,
      });
      const received = new Set(
        snapshot.upserts.map((upsert) => upsert.externalId),
      );
      const existing = this.dependencies.db
        .prepare(
          "SELECT external_id FROM calendar_events WHERE source_id = ? AND deleted_at IS NULL",
        )
        .all(sourceId) as Array<{ external_id: string }>;
      this.dependencies.calendar.applySyncBatch({
        sourceId,
        previousCursor: source.syncCursor,
        nextCursor: snapshot.nextCursor,
        syncedAt: snapshot.syncedAt,
        upserts: snapshot.upserts,
        tombstones: existing
          .filter((event) => !received.has(event.external_id))
          .map((event) => ({
            externalId: event.external_id,
            providerUpdatedAt: snapshot.syncedAt,
          })),
      });
    } catch (error) {
      const attemptedAt = this.dependencies.clock().toISOString();
      const publicMessage =
        error instanceof RemoteCalendarError
          ? error.message
          : "Calendar synchronization failed";
      this.dependencies.db
        .prepare(
          `UPDATE calendar_sources
           SET status = 'degraded', last_error = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(publicMessage.slice(0, 2_000), attemptedAt, sourceId);
    }
  }

  private linkedSources(sourceIds?: string[]): LinkedSourceRow[] {
    if (sourceIds?.length === 0) return [];
    if (!sourceIds) {
      return this.dependencies.db
        .prepare("SELECT * FROM calendar_linked_sources ORDER BY rowid ASC")
        .all() as LinkedSourceRow[];
    }
    return this.dependencies.db
      .prepare(
        `SELECT * FROM calendar_linked_sources
         WHERE source_id IN (${sourceIds.map(() => "?").join(", ")})
         ORDER BY rowid ASC`,
      )
      .all(...sourceIds) as LinkedSourceRow[];
  }

  private isSyncDue(sourceId: string): boolean {
    const source = this.requireSource(sourceId);
    const lastAttempt = source.lastSyncedAt ?? source.updatedAt;
    return (
      this.dependencies.clock().getTime() - new Date(lastAttempt).getTime() >=
      this.syncTtlMs
    );
  }

  private requireAccount(accountId: string): void {
    const account = this.dependencies.db
      .prepare("SELECT id FROM connector_accounts WHERE id = ?")
      .get(accountId);
    if (!account) throw new Error("Inbox account not found");
  }

  private requireSource(sourceId: string): CalendarSource {
    const source = this.dependencies.calendar
      .listSources()
      .find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error("Calendar source not found");
    return source;
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Calendar ${label} is required`);
  return normalized;
}
