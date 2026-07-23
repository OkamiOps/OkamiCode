import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import { existsSync } from "node:fs";
import { createVerifiedDatabaseBackup } from "./backup";
import { latestMigrationVersion, runMigrations } from "./migrations";

export type Database = ReturnType<typeof openDatabase>;

export function openDatabase(
  file: string,
  key: Buffer,
  options?: {
    backupDirectory?: string;
    now?: Date;
  },
): InstanceType<typeof SqliteDatabase> {
  const existedBeforeOpen = existsSync(file);
  const db = new SqliteDatabase(file);
  try {
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`key="x'${key.toString("hex")}'"`);
    db.pragma("foreign_keys = ON");
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    const currentVersion = db.pragma("user_version", {
      simple: true,
    }) as number;
    if (
      existedBeforeOpen &&
      options?.backupDirectory &&
      currentVersion < latestMigrationVersion()
    ) {
      createVerifiedDatabaseBackup({
        database: db,
        databaseFile: file,
        backupDirectory: options.backupDirectory,
        key,
        now: options.now,
      });
    }
    runMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
