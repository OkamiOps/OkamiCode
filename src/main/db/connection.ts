import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import { runMigrations } from "./migrations";

export type Database = ReturnType<typeof openDatabase>;

export function openDatabase(
  file: string,
  key: Buffer,
): InstanceType<typeof SqliteDatabase> {
  const db = new SqliteDatabase(file);
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`key="x'${key.toString("hex")}'"`);
  db.pragma("foreign_keys = ON");
  db.prepare("SELECT count(*) FROM sqlite_master").get();
  runMigrations(db);
  return db;
}
