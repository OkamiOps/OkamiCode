import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./connection";
import {
  createVerifiedDatabaseBackup,
  restoreVerifiedDatabaseBackup,
} from "./backup";

describe("encrypted database backup and restore", () => {
  it("creates a verified encrypted snapshot and restores the selected state", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "okami-backup-"));
    const databaseFile = path.join(dir, "workbench.db");
    const backupDirectory = path.join(dir, "backups");
    const key = Buffer.alloc(32, 17);
    const now = new Date("2026-07-23T12:00:00.000Z");
    const database = openDatabase(databaseFile, key);

    database
      .prepare(
        `INSERT INTO tasks
          (id, kind, title, objective, status, created_at, updated_at, workspace_path)
         VALUES (?, 'workbench', ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        "task-before-backup",
        "Projeto preservado",
        "Não perder trabalho",
        now.toISOString(),
        now.toISOString(),
        "/Users/marcos/Documents/Git/OKamiCode-LP",
      );

    const backup = createVerifiedDatabaseBackup({
      database,
      databaseFile,
      backupDirectory,
      key,
      now,
    });
    expect(existsSync(backup.file)).toBe(true);
    expect(backup.integrity).toBe("ok");
    expect(() => openDatabase(backup.file, Buffer.alloc(32, 18))).toThrow();

    database
      .prepare("UPDATE tasks SET title = ? WHERE id = ?")
      .run("Alteração posterior", "task-before-backup");
    database.close();

    const restored = restoreVerifiedDatabaseBackup({
      backupFile: backup.file,
      databaseFile,
      key,
      now: new Date("2026-07-23T12:05:00.000Z"),
    });
    expect(restored.integrity).toBe("ok");
    expect(restored.safetyCopy).toBeTruthy();
    expect(existsSync(restored.safetyCopy!)).toBe(true);

    const reopened = openDatabase(databaseFile, key);
    expect(
      reopened
        .prepare("SELECT title FROM tasks WHERE id = ?")
        .pluck()
        .get("task-before-backup"),
    ).toBe("Projeto preservado");
    reopened.close();
  });

  it("does not replace the current database when the backup key is invalid", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "okami-restore-reject-"));
    const databaseFile = path.join(dir, "workbench.db");
    const backupFile = path.join(dir, "candidate.db");
    const currentKey = Buffer.alloc(32, 31);
    const foreignKey = Buffer.alloc(32, 32);
    openDatabase(databaseFile, currentKey).close();
    openDatabase(backupFile, foreignKey).close();

    expect(() =>
      restoreVerifiedDatabaseBackup({
        backupFile,
        databaseFile,
        key: currentKey,
        now: new Date("2026-07-23T12:10:00.000Z"),
      }),
    ).toThrow();

    expect(() => openDatabase(databaseFile, currentKey)).not.toThrow();
  });
});
