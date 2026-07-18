import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import { readFileSync } from "node:fs";
import path from "node:path";

export function runMigrations(db: InstanceType<typeof SqliteDatabase>): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version >= 1) return;
  const sql = readFileSync(
    path.join(import.meta.dirname, "schema/001-phase1-core.sql"),
    "utf8",
  );
  db.exec(sql);
}
