import { createHash } from "node:crypto";
import type { Database } from "../db/connection";
import { isSafeCalendarHttpUrl } from "../../shared/contracts/calendar-url";
import {
  RemoteCalendarError,
  parseCalendarPayload,
  type LinkedCalendarAuthentication,
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
import type { GoogleCalendarSynchronizer } from "./google-adapter";

export interface CreateLinkedSourceInput {
  accountId: string;
  protocol: LinkedCalendarProtocol;
  authentication: LinkedCalendarAuthentication;
  calendarUrl: string;
  displayName: string;
  color: string;
  timezone: string;
}

interface LinkedSourceRow {
  source_id: string;
  account_id: string;
  protocol: LinkedCalendarProtocol;
  authentication: LinkedCalendarAuthentication;
  calendar_url: string;
}

interface GoogleSourceRow {
  source_id: string;
  account_id: string;
}

export interface ImportInboxInvitationsInput {
  accountId: string;
  accountDisplayName: string;
  accountAddress: string;
  invitations: Array<{ externalMessageId: string; payload: string }>;
  syncedAt: string;
}

export class CalendarApplicationService {
  private readonly syncTtlMs: number;

  constructor(
    private readonly dependencies: {
      db: Database;
      calendar: CalendarService;
      synchronizer: RemoteCalendarSynchronizer;
      googleSynchronizer?: GoogleCalendarSynchronizer;
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

  reconcileInboxInvitationSources(): number {
    const accounts = this.dependencies.db
      .prepare(
        `SELECT account.id, account.display_name, account.address
           FROM connector_accounts account
           LEFT JOIN calendar_inbox_sources linked
             ON linked.account_id = account.id
          WHERE linked.account_id IS NULL
          ORDER BY account.created_at ASC, account.id ASC`,
      )
      .all() as Array<{
      id: string;
      display_name: string;
      address: string;
    }>;
    const syncedAt = this.dependencies.clock().toISOString();
    for (const account of accounts) {
      this.importInboxInvitations({
        accountId: account.id,
        accountDisplayName: account.display_name,
        accountAddress: account.address,
        invitations: [],
        syncedAt,
      });
    }
    return accounts.length;
  }

  async reconcileGoogleSources(): Promise<number> {
    const accounts = this.dependencies.db
      .prepare(
        `SELECT account.id, account.display_name
           FROM connector_accounts account
           LEFT JOIN calendar_google_sources linked
             ON linked.account_id = account.id
          WHERE account.provider = 'gmail' AND linked.account_id IS NULL
          ORDER BY account.created_at ASC, account.id ASC`,
      )
      .all() as Array<{ id: string; display_name: string }>;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    for (const account of accounts) {
      await this.ensureGoogleSource(account.id, account.display_name, timezone);
    }
    return accounts.length;
  }

  async createLinkedSource(
    input: CreateLinkedSourceInput,
  ): Promise<CalendarSource> {
    this.requireAccount(input.accountId);
    if (input.protocol === "caldav" && input.authentication !== "account") {
      throw new Error("CalDAV requires account authentication");
    }
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
           (source_id, account_id, protocol, calendar_url, authentication,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceId,
          input.accountId,
          input.protocol,
          input.calendarUrl,
          input.authentication,
          now,
          now,
        );
    })();
    await this.synchronizeSource(sourceId);
    return this.requireSource(sourceId);
  }

  async listEvents(input: ListEventsInput = {}): Promise<CalendarEvent[]> {
    const mappings = this.linkedSources(input.sourceIds);
    const googleMappings = this.googleSources(input.sourceIds);
    await Promise.all(
      [
        ...mappings.map((mapping) => ({
          ...mapping,
          provider: "linked" as const,
        })),
        ...googleMappings.map((mapping) => ({
          ...mapping,
          provider: "google" as const,
        })),
      ]
        .filter((mapping) => this.isSyncDue(mapping.source_id))
        .map((mapping) =>
          mapping.provider === "google"
            ? this.synchronizeGoogleSource(mapping.source_id)
            : this.synchronizeSource(mapping.source_id),
        ),
    );
    return this.dependencies.calendar.listEvents(input);
  }

  async ensureGoogleSource(
    accountId: string,
    displayName: string,
    timezone: string,
  ): Promise<CalendarSource> {
    this.requireAccount(accountId);
    const existing = this.dependencies.db
      .prepare(
        "SELECT source_id FROM calendar_google_sources WHERE account_id = ?",
      )
      .get(accountId) as { source_id: string } | undefined;
    const sourceId = existing?.source_id ?? this.dependencies.createId();
    if (!existing) {
      const now = this.dependencies.clock().toISOString();
      this.dependencies.db.transaction(() => {
        this.dependencies.db
          .prepare(
            `INSERT INTO calendar_sources
             (id, kind, display_name, color, timezone, status, sync_cursor,
              last_error, last_synced_at, created_at, updated_at)
             VALUES (?, 'google', ?, '#4285F4', ?, 'active', NULL, NULL, NULL, ?, ?)`,
          )
          .run(
            sourceId,
            `Google Agenda · ${requiredText(displayName, "display name")}`,
            requiredText(timezone, "timezone"),
            now,
            now,
          );
        this.dependencies.db
          .prepare(
            `INSERT INTO calendar_google_sources
             (source_id, account_id, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(sourceId, accountId, now, now);
      })();
    }
    await this.synchronizeGoogleSource(sourceId);
    return this.requireSource(sourceId);
  }

  importInboxInvitations(input: ImportInboxInvitationsInput): void {
    this.requireAccount(input.accountId);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const upserts = input.invitations.flatMap((invitation) => {
      try {
        return parseCalendarPayload(
          invitation.payload,
          timezone,
          null,
          null,
          input.syncedAt,
        );
      } catch {
        return [];
      }
    });
    const existing = this.dependencies.db
      .prepare(
        `SELECT source_id FROM calendar_inbox_sources WHERE account_id = ?`,
      )
      .get(input.accountId) as { source_id: string } | undefined;
    const sourceId = existing?.source_id ?? this.dependencies.createId();
    const now = this.dependencies.clock().toISOString();
    if (!existing) {
      const displayName = requiredText(
        input.accountDisplayName.trim() || input.accountAddress,
        "account display name",
      );
      this.dependencies.db.transaction(() => {
        this.dependencies.db
          .prepare(
            `INSERT INTO calendar_sources
             (id, kind, display_name, color, timezone, status, sync_cursor,
              last_error, last_synced_at, created_at, updated_at)
             VALUES (?, 'ics', ?, '#22D3EE', ?, 'active', NULL, NULL, NULL, ?, ?)`,
          )
          .run(sourceId, `Convites · ${displayName}`, timezone, now, now);
        this.dependencies.db
          .prepare(
            `INSERT INTO calendar_inbox_sources
             (source_id, account_id, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(sourceId, input.accountId, now, now);
      })();
    }
    const source = this.requireSource(sourceId);
    const nextCursor = createHash("sha256")
      .update(
        input.invitations
          .map(
            (invitation) =>
              `${invitation.externalMessageId}\u0000${invitation.payload}`,
          )
          .join("\u0001"),
      )
      .digest("hex");
    const uniqueUpserts = [
      ...new Map(upserts.map((event) => [event.externalId, event])).values(),
    ];
    this.dependencies.calendar.applySyncBatch({
      sourceId,
      previousCursor: source.syncCursor,
      nextCursor,
      syncedAt: input.syncedAt,
      upserts: uniqueUpserts,
      tombstones: [],
    });
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
        authentication: mapping.authentication,
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

  private async synchronizeGoogleSource(sourceId: string): Promise<void> {
    const mapping = this.googleSources([sourceId])[0];
    if (!mapping) return;
    const source = this.requireSource(sourceId);
    try {
      if (!this.dependencies.googleSynchronizer) {
        throw new RemoteCalendarError(
          "Google Agenda synchronization unavailable",
        );
      }
      const snapshot = await this.dependencies.googleSynchronizer.synchronize({
        accountId: mapping.account_id,
        timezone: source.timezone,
      });
      const received = new Set(
        snapshot.upserts.map((event) => event.externalId),
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
        error instanceof Error
          ? error.message
          : "Google Agenda synchronization failed";
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

  private googleSources(sourceIds?: string[]): GoogleSourceRow[] {
    if (sourceIds?.length === 0) return [];
    if (!sourceIds) {
      return this.dependencies.db
        .prepare("SELECT * FROM calendar_google_sources ORDER BY rowid ASC")
        .all() as GoogleSourceRow[];
    }
    return this.dependencies.db
      .prepare(
        `SELECT * FROM calendar_google_sources
         WHERE source_id IN (${sourceIds.map(() => "?").join(", ")})
         ORDER BY rowid ASC`,
      )
      .all(...sourceIds) as GoogleSourceRow[];
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
