import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../db/test-support";
import { CalendarApplicationService } from "./application-service";
import { CalendarService, type CalendarSyncUpsert } from "./service";

const accountId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
const sourceId = "4d32d86d-3199-4327-9d0c-e283268ed239";
const eventId = "a8f22e35-fc52-460a-a65f-52b621dd8cb3";

const timedUpsert: CalendarSyncUpsert = {
  externalId: "remote-1",
  title: "Planejamento",
  timezone: "UTC",
  providerUpdatedAt: "2026-07-21T12:00:00.000Z",
  allDay: false,
  startsAt: "2026-07-21T14:00:00.000Z",
  endsAt: "2026-07-21T15:00:00.000Z",
};

function fixture(options: { fail?: Error; lastSyncedAt?: string } = {}) {
  const fx = createTestDatabase();
  fx.db
    .prepare(
      `INSERT INTO connector_accounts
       (id, provider, display_name, address, status, sync_cursor, last_error,
        last_synced_at, created_at, updated_at)
       VALUES (?, 'imap', 'Trabalho', 'marcos@example.com', 'connected', NULL,
               NULL, NULL, ?, ?)`,
    )
    .run(accountId, "2026-07-21T11:00:00.000Z", "2026-07-21T11:00:00.000Z");
  let id = 0;
  const calendar = new CalendarService({
    db: fx.db,
    createId: () => [sourceId, eventId, crypto.randomUUID()][id++]!,
    clock: () => "2026-07-21T12:00:00.000Z",
  });
  const synchronizer = {
    synchronize: vi.fn(async () => {
      if (options.fail) throw options.fail;
      return {
        nextCursor: "cursor-1",
        syncedAt: "2026-07-21T12:00:00.000Z",
        upserts: [timedUpsert],
      };
    }),
  };
  const googleSynchronizer = {
    synchronize: vi.fn(async () => ({
      nextCursor: "google-cursor-1",
      syncedAt: "2026-07-21T12:00:00.000Z",
      upserts: [timedUpsert],
    })),
  };
  const service = new CalendarApplicationService({
    db: fx.db,
    calendar,
    synchronizer,
    googleSynchronizer,
    createId: () => sourceId,
    clock: () => new Date("2026-07-21T12:00:00.000Z"),
    syncTtlMs: 5 * 60 * 1000,
  });
  return { fx, calendar, synchronizer, googleSynchronizer, service };
}

describe("CalendarApplicationService", () => {
  it("creates one Google source per account and synchronizes it idempotently", async () => {
    const { fx, googleSynchronizer, service } = fixture();

    const first = await service.ensureGoogleSource(
      accountId,
      "Pessoal",
      "Europe/Berlin",
    );
    const second = await service.ensureGoogleSource(
      accountId,
      "Pessoal",
      "Europe/Berlin",
    );

    expect(first).toMatchObject({
      id: sourceId,
      kind: "google",
      displayName: "Google Agenda · Pessoal",
      status: "active",
    });
    expect(second.id).toBe(first.id);
    expect(googleSynchronizer.synchronize).toHaveBeenCalledTimes(2);
    expect(
      fx.db
        .prepare("SELECT COUNT(*) AS count FROM calendar_google_sources")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("persists only the public account mapping and synchronizes on linked-source creation", async () => {
    const { fx, synchronizer, service } = fixture();

    const source = await service.createLinkedSource({
      accountId,
      protocol: "caldav",
      authentication: "account",
      calendarUrl: "https://calendar.example/caldav/marcos",
      displayName: "Trabalho",
      color: "#ff7a1a",
      timezone: "UTC",
    });

    expect(source).toMatchObject({
      id: sourceId,
      kind: "caldav",
      status: "active",
      color: "#FF7A1A",
      lastError: null,
      lastSyncedAt: "2026-07-21T12:00:00.000Z",
    });
    expect(synchronizer.synchronize).toHaveBeenCalledOnce();
    expect(await service.listEvents({ sourceIds: [sourceId] })).toEqual([
      expect.objectContaining({ externalId: "remote-1" }),
    ]);
    const mapping = fx.db
      .prepare("SELECT * FROM calendar_linked_sources")
      .get() as Record<string, unknown>;
    expect(mapping).toMatchObject({
      source_id: sourceId,
      account_id: accountId,
      protocol: "caldav",
      calendar_url: "https://calendar.example/caldav/marcos",
    });
    expect(JSON.stringify(mapping)).not.toMatch(/password|token|secret/iu);
  });

  it("keeps a failed source degraded with a sanitized error", async () => {
    const { fx, service } = fixture({
      fail: new Error("Bearer access-token-secret failed"),
    });

    const source = await service.createLinkedSource({
      accountId,
      protocol: "ics",
      authentication: "account",
      calendarUrl: "https://calendar.example/feed.ics",
      displayName: "Trabalho",
      color: "#FF7A1A",
      timezone: "UTC",
    });

    expect(source).toMatchObject({
      status: "degraded",
      lastError: "Calendar synchronization failed",
      lastSyncedAt: null,
    });
    expect(
      JSON.stringify(fx.db.prepare("SELECT * FROM calendar_sources").all()),
    ).not.toContain("access-token-secret");
  });

  it("refreshes linked sources while listing only after the TTL expires", async () => {
    const { fx, synchronizer, service } = fixture();
    await service.createLinkedSource({
      accountId,
      protocol: "ics",
      authentication: "account",
      calendarUrl: "https://calendar.example/feed.ics",
      displayName: "Trabalho",
      color: "#FF7A1A",
      timezone: "UTC",
    });
    synchronizer.synchronize.mockClear();

    await service.listEvents({ sourceIds: [sourceId] });
    expect(synchronizer.synchronize).not.toHaveBeenCalled();

    fx.db
      .prepare(
        "UPDATE calendar_sources SET last_synced_at = ?, updated_at = ? WHERE id = ?",
      )
      .run("2026-07-21T11:54:59.999Z", "2026-07-21T11:54:59.999Z", sourceId);
    await service.listEvents({ sourceIds: [sourceId] });
    expect(synchronizer.synchronize).toHaveBeenCalledOnce();
  });

  it("creates one Inbox invitation source per account and imports ICS events", async () => {
    const { fx, service } = fixture();

    service.importInboxInvitations({
      accountId,
      accountDisplayName: "OkamiOps",
      accountAddress: "marcos@okamiops.com",
      syncedAt: "2026-07-21T12:00:00.000Z",
      invitations: [
        {
          externalMessageId: "invite-message-1",
          payload: `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:invite-1
SUMMARY:Reunião com cliente
DTSTART:20260722T090000Z
DTEND:20260722T100000Z
ORGANIZER:mailto:cliente@example.com
END:VEVENT
END:VCALENDAR`,
        },
      ],
    });

    expect(service.listSources()).toEqual([
      expect.objectContaining({
        displayName: "Convites · OkamiOps",
        kind: "ics",
        status: "active",
      }),
    ]);
    await expect(service.listEvents()).resolves.toEqual([
      expect.objectContaining({
        externalId: "invite-1",
        title: "Reunião com cliente",
      }),
    ]);
    expect(
      fx.db.prepare("SELECT account_id FROM calendar_inbox_sources").get(),
    ).toEqual({ account_id: accountId });
  });

  it("exposes an empty Inbox invitation source after the first successful mail sync", () => {
    const { service } = fixture();

    service.importInboxInvitations({
      accountId,
      accountDisplayName: "OkamiOps",
      accountAddress: "marcos@okamiops.com",
      syncedAt: "2026-07-21T12:00:00.000Z",
      invitations: [],
    });

    expect(service.listSources()).toEqual([
      expect.objectContaining({
        displayName: "Convites · OkamiOps",
        kind: "ics",
        status: "active",
      }),
    ]);
  });

  it("reconciles existing Inbox accounts so Agenda is complete on startup", () => {
    const { service } = fixture();

    expect(service.reconcileInboxInvitationSources()).toBe(1);
    expect(service.reconcileInboxInvitationSources()).toBe(0);
    expect(service.listSources()).toEqual([
      expect.objectContaining({ displayName: "Convites · Trabalho" }),
    ]);
  });
});
