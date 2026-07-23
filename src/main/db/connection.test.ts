import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./connection";

describe("openDatabase", () => {
  it("encrypts with SQLCipher, migrates to the latest version, and rejects a wrong key", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "okami-db-"));
    const file = path.join(dir, "workbench.db");
    const key = Buffer.alloc(32, 7);
    const db = openDatabase(file, key);
    expect(db.prepare("SELECT sqlite3mc_version()").pluck().get()).toBeTruthy();
    expect(db.pragma("user_version", { simple: true })).toBe(25);
    expect(
      db
        .prepare("PRAGMA table_info(inbox_messages)")
        .all()
        .some((column) => (column as { name: string }).name === "provider_uid"),
    ).toBe(true);
    expect(
      db
        .prepare("PRAGMA table_info(inbox_messages)")
        .all()
        .some((column) => (column as { name: string }).name === "seen"),
    ).toBe(true);
    expect(
      db
        .prepare("PRAGMA table_info(inbox_messages)")
        .all()
        .some(
          (column) =>
            (column as { name: string }).name === "remote_seen_override",
        ),
    ).toBe(true);
    const settingsSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inbox_account_settings'",
      )
      .pluck()
      .get() as string;
    expect(settingsSql).toContain("ON DELETE CASCADE");
    const outgoingSettingsSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inbox_outgoing_settings'",
      )
      .pluck()
      .get() as string;
    expect(outgoingSettingsSql).toContain("ON DELETE CASCADE");
    expect(outgoingSettingsSql).toContain("from_addresses_json");
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_outgoing_settings
           (account_id, host, port, secure, created_at, updated_at)
           VALUES ('missing', '', 0, 2, 'now', 'now')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO inbox_account_settings
           (account_id, host, port, secure, mailbox, max_initial_messages,
            max_message_bytes, created_at, updated_at)
           VALUES ('missing', 'mail.example.com', 0, 2, 'INBOX', 0, 0, 'now', 'now')`,
        )
        .run(),
    ).toThrow();
    const calendarSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_sources'",
      )
      .pluck()
      .get() as string;
    expect(calendarSql).toContain(
      "CHECK(kind IN ('local', 'google', 'outlook', 'caldav', 'ics'))",
    );
    expect(calendarSql).not.toMatch(/credential|secret|token|password/i);
    const linkedCalendarSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_linked_sources'",
      )
      .pluck()
      .get() as string;
    expect(linkedCalendarSql).toContain("REFERENCES connector_accounts(id)");
    expect(linkedCalendarSql).toContain("authentication");
    expect(linkedCalendarSql).not.toMatch(/credential|secret|token|password/i);
    const googleCalendarSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_google_sources'",
      )
      .pluck()
      .get() as string;
    expect(googleCalendarSql).toContain("REFERENCES connector_accounts(id)");
    expect(googleCalendarSql).not.toMatch(/credential|secret|token|password/i);
    expect(() =>
      db
        .prepare(
          `INSERT INTO calendar_sources
           (id, kind, display_name, color, timezone, status, created_at, updated_at)
           VALUES ('remote', 'google', 'Google', '#336699', 'UTC', 'not_configured', 'now', 'now')`,
        )
        .run(),
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO calendar_events
           (id, source_id, external_id, title, attendees_json, status, all_day, timezone,
            start_date, end_date, created_at, updated_at)
           VALUES ('missing-source', 'missing', 'event', 'Event', '[]', 'confirmed', 1,
                   'UTC', '2026-07-21', '2026-07-22', 'now', 'now')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO calendar_events
           (id, source_id, external_id, title, attendees_json, status, all_day, timezone,
            created_at, updated_at)
           VALUES ('invalid-shape', 'remote', 'event', 'Event', '[]', 'confirmed', 0,
                   'UTC', 'now', 'now')`,
        )
        .run(),
    ).toThrow();
    db.close();
    expect(() => openDatabase(file, Buffer.alloc(32, 8))).toThrow();
  });

  it("backfills historical assistant completions into the shared conversation", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "okami-db-context-"));
    const file = path.join(dir, "workbench.db");
    const key = Buffer.alloc(32, 8);
    const db = openDatabase(file, key);
    db.exec(`
      INSERT INTO tasks
        (id, kind, title, objective, status, created_at, updated_at)
      VALUES
        ('task-context', 'workbench', 'Context', 'Share context', 'active',
         '2026-07-23T10:00:00.000Z', '2026-07-23T10:00:00.000Z');
      INSERT INTO runtime_lanes
        (id, task_id, runtime_kind, provider_kind, model, status,
         last_event_cursor, created_at, updated_at)
      VALUES
        ('lane-context', 'task-context', 'claude', 'claude_max', 'opus',
         'ready', 0, '2026-07-23T10:00:00.000Z',
         '2026-07-23T10:00:00.000Z');
      INSERT INTO runs
        (id, task_id, lane_id, status, started_at, finished_at)
      VALUES
        ('run-context', 'task-context', 'lane-context', 'completed',
         '2026-07-23T10:00:00.000Z', '2026-07-23T10:01:00.000Z');
      INSERT INTO events
        (id, task_id, lane_id, run_id, sequence, occurred_at, kind,
         native_event_id, payload_json)
      VALUES
        ('answer-context', 'task-context', 'lane-context', 'run-context', 1,
         '2026-07-23T10:01:00.000Z', 'message_completed', NULL,
         '{"text":"Resposta histórica preservada"}');
    `);
    db.pragma("user_version = 24");
    db.close();

    const migrated = openDatabase(file, key);
    const row = migrated
      .prepare(
        `SELECT role, content_json FROM messages
         WHERE id = 'event:answer-context'`,
      )
      .get() as { role: string; content_json: string };
    expect(row.role).toBe("assistant");
    expect(JSON.parse(row.content_json)).toEqual({
      body: "Resposta histórica preservada",
      laneId: "lane-context",
      providerLabel: "claude",
      model: "opus",
    });
    migrated.close();
  });

  it("backfills the official Hostinger SMTP endpoint for existing IMAP accounts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "okami-db-hostinger-"));
    const file = path.join(dir, "workbench.db");
    const backupDirectory = path.join(dir, "backups");
    const key = Buffer.alloc(32, 9);
    const db = openDatabase(file, key);
    db.prepare(
      `INSERT INTO connector_accounts
       (id, provider, display_name, address, status, sync_cursor, last_error,
        last_synced_at, created_at, updated_at)
       VALUES ('hostinger-account', 'imap', 'Projetos', 'me@example.com',
               'connected', NULL, NULL, NULL, 'created', 'updated')`,
    ).run();
    db.prepare(
      `INSERT INTO inbox_account_settings
       (account_id, host, port, secure, mailbox, max_initial_messages,
        max_message_bytes, created_at, updated_at)
       VALUES ('hostinger-account', 'imap.hostinger.com', 993, 1, 'INBOX',
               100, 2097152, 'created', 'updated')`,
    ).run();
    db.exec(`
      DROP INDEX inbox_agent_assignments_status_updated_idx;
      DROP TABLE inbox_agent_assignments;
      DROP INDEX inbox_threads_folder_last_message_idx;
      ALTER TABLE inbox_threads DROP COLUMN folder;
      DROP INDEX inbox_messages_account_provider_uid_idx;
      ALTER TABLE inbox_messages DROP COLUMN provider_uid;
      ALTER TABLE inbox_messages DROP COLUMN seen;
      ALTER TABLE inbox_messages DROP COLUMN remote_seen_override;
      DROP TRIGGER calendar_google_source_delete_source;
      DROP TABLE calendar_google_sources;
      DROP TRIGGER calendar_inbox_source_delete_source;
      DROP TABLE calendar_inbox_sources;
      ALTER TABLE calendar_linked_sources DROP COLUMN authentication;
    `);
    db.pragma("user_version = 16");
    db.close();

    const migrated = openDatabase(file, key, {
      backupDirectory,
      now: new Date("2026-07-23T12:20:00.000Z"),
    });
    expect(readdirSync(backupDirectory)).toEqual([
      "workbench-2026-07-23T12-20-00.000Z.db",
    ]);
    expect(
      migrated
        .prepare(
          `SELECT host, port, secure, from_addresses_json
             FROM inbox_outgoing_settings
            WHERE account_id = 'hostinger-account'`,
        )
        .get(),
    ).toEqual({
      host: "smtp.hostinger.com",
      port: 465,
      secure: 1,
      from_addresses_json: "[]",
    });
    migrated.close();

    const current = openDatabase(file, key, {
      backupDirectory,
      now: new Date("2026-07-23T12:21:00.000Z"),
    });
    current.close();
    expect(readdirSync(backupDirectory)).toHaveLength(1);
  });
});
