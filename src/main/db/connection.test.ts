import { mkdtempSync } from "node:fs";
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
    expect(db.pragma("user_version", { simple: true })).toBe(18);
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

  it("backfills the official Hostinger SMTP endpoint for existing IMAP accounts", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "okami-db-hostinger-"));
    const file = path.join(dir, "workbench.db");
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
      DROP TRIGGER calendar_inbox_source_delete_source;
      DROP TABLE calendar_inbox_sources;
      ALTER TABLE calendar_linked_sources DROP COLUMN authentication;
    `);
    db.pragma("user_version = 16");
    db.close();

    const migrated = openDatabase(file, key);
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
  });
});
