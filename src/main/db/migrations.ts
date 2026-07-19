import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATIONS = [
  "schema/001-phase1-core.sql",
  "schema/002-task-workspace.sql",
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
