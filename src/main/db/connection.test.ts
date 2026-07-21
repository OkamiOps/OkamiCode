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
    expect(db.pragma("user_version", { simple: true })).toBe(12);
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
    db.close();
    expect(() => openDatabase(file, Buffer.alloc(32, 8))).toThrow();
  });
});
