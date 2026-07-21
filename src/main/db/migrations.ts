import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS = [
  "schema/001-phase1-core.sql",
  "schema/002-task-workspace.sql",
  "schema/003-lane-workspace-repair.sql",
  "schema/004-events-run-scoped-sequence.sql",
  "schema/005-close-orphan-runs.sql",
  "schema/006-lane-permission-mode.sql",
  "schema/007-kanban-cards.sql",
  "schema/008-external-outbox.sql",
  "schema/009-inbox-core.sql",
  "schema/010-inbox-account-settings.sql",
  "schema/011-inbox-task-actions.sql",
  "schema/012-inbox-outgoing-settings.sql",
];

export function runMigrations(db: InstanceType<typeof SqliteDatabase>): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let next = version; next < MIGRATIONS.length; next += 1) {
    const sql = readFileSync(
      path.join(import.meta.dirname, MIGRATIONS[next]),
      "utf8",
    );
    db.exec(sql);
  }
}
