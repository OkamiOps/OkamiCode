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
    expect(db.pragma("user_version", { simple: true })).toBe(5);
    db.close();
    expect(() => openDatabase(file, Buffer.alloc(32, 8))).toThrow();
  });
});
