import { app, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// The raw key never touches disk: only the safeStorage-encrypted blob is persisted,
// and safeStorage's own key lives in the macOS Keychain.
export function getOrCreateDatabaseKey(): Buffer {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Keychain-backed encryption unavailable");
  const blobPath = path.join(app.getPath("userData"), "db-key.enc");
  if (existsSync(blobPath))
    return Buffer.from(
      safeStorage.decryptString(readFileSync(blobPath)),
      "base64",
    );
  const key = randomBytes(32);
  writeFileSync(blobPath, safeStorage.encryptString(key.toString("base64")), {
    mode: 0o600,
  });
  return key;
}
