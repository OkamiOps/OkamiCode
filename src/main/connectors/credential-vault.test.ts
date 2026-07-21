import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectorCredentialVault, type SafeStorage } from "./credential-vault";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class FakeSafeStorage implements SafeStorage {
  available = true;
  decryptError: Error | undefined;
  encryptError: Error | undefined;

  isEncryptionAvailable() {
    return this.available;
  }

  encryptString(value: string) {
    if (this.encryptError) throw this.encryptError;
    return Buffer.from(`vault:${Buffer.from(value).toString("base64")}`);
  }

  decryptString(blob: Buffer) {
    if (this.decryptError) throw this.decryptError;
    const encoded = blob.toString("utf8");
    if (!encoded.startsWith("vault:")) throw new Error("bad fake blob");
    return Buffer.from(encoded.slice("vault:".length), "base64").toString(
      "utf8",
    );
  }
}

async function createVault(safeStorage = new FakeSafeStorage()) {
  const directory = await mkdtemp(path.join(tmpdir(), "okami-vault-"));
  await rm(directory, { recursive: true, force: true });
  temporaryDirectories.push(directory);
  return {
    directory,
    safeStorage,
    vault: new ConnectorCredentialVault(directory, safeStorage),
  };
}

describe("ConnectorCredentialVault", () => {
  it("round-trips each credential kind without persisting plaintext", async () => {
    const { directory, vault } = await createVault();
    const imap = {
      version: 1 as const,
      kind: "imap_password" as const,
      username: "marcos@example.com",
      password: "passphrase-not-on-disk",
    };
    const oauth = {
      version: 1 as const,
      kind: "oauth" as const,
      username: "maria@example.com",
      accessToken: "access-token-not-on-disk",
      refreshToken: "refresh-token-not-on-disk",
      expiresAt: "2026-08-01T00:00:00.000Z",
      google: {
        clientId: "desktop-client.apps.googleusercontent.com",
        clientSecret: "desktop-client-secret-not-on-disk",
        scopes: ["openid", "email", "https://mail.google.com/"],
      },
    };

    await vault.set("imap-account", imap);
    await vault.set("oauth-account", oauth);

    const readImap = await vault.get("imap-account");
    expect(readImap).toEqual(imap);
    if (readImap?.kind === "imap_password") readImap.password = "mutated";
    expect(await vault.get("imap-account")).toEqual(imap);
    expect(await vault.get("oauth-account")).toEqual(oauth);
    const blobs = await Promise.all(
      (await readdir(directory)).map((file) =>
        readFile(path.join(directory, file)),
      ),
    );
    expect(Buffer.concat(blobs).toString("utf8")).not.toContain(imap.password);
    expect(Buffer.concat(blobs).toString("utf8")).not.toContain(
      oauth.accessToken,
    );
    expect(Buffer.concat(blobs).toString("utf8")).not.toContain(
      oauth.refreshToken,
    );
    expect(Buffer.concat(blobs).toString("utf8")).not.toContain(
      oauth.google.clientSecret,
    );
  });

  it("uses an account hash filename and never treats account ids as paths", async () => {
    const { directory, vault } = await createVault();

    await vault.set("../../outside/credential", {
      version: 1,
      kind: "imap_password",
      username: "marcos@example.com",
      password: "secret",
    });

    const files = await readdir(directory);
    expect(files).toEqual([
      `${createHash("sha256").update("../../outside/credential").digest("hex")}.enc`,
    ]);
    expect(files[0]).not.toContain("outside");
    expect(files[0]).not.toContain("/");
    await expect(vault.set("", {} as never)).rejects.toThrow(
      /set .*\b[a-f0-9]{12}\b/i,
    );
  });

  it("creates private storage and atomically preserves a previous value on failure", async () => {
    const { directory, safeStorage, vault } = await createVault();
    const first = {
      version: 1 as const,
      kind: "imap_password" as const,
      username: "marcos@example.com",
      password: "first-secret",
    };

    await vault.set("atomic-account", first);
    safeStorage.encryptError = new Error("replacement-secret must not leak");

    await expect(
      vault.set("atomic-account", {
        ...first,
        password: "replacement-secret",
      }),
    ).rejects.toThrow(/set .*\b[a-f0-9]{12}\b/i);
    expect(await vault.get("atomic-account")).toEqual(first);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const [file] = await readdir(directory);
    expect((await stat(path.join(directory, file))).mode & 0o777).toBe(0o600);
  });

  it("fails closed for decrypted invalid, tampered, or extra-field payloads", async () => {
    const { directory, safeStorage, vault } = await createVault();
    const accountId = "tampered-account";
    await vault.set(accountId, {
      version: 1,
      kind: "imap_password",
      username: "marcos@example.com",
      password: "secret",
    });
    const [file] = await readdir(directory);
    const blobPath = path.join(directory, file);

    await writeFile(blobPath, safeStorage.encryptString("not json"), {
      mode: 0o600,
    });
    await expect(vault.get(accountId)).rejects.toThrow(
      /get .*\b[a-f0-9]{12}\b/i,
    );
    await writeFile(blobPath, Buffer.from("tampered ciphertext"), {
      mode: 0o600,
    });
    await expect(vault.get(accountId)).rejects.toThrow(
      /get .*\b[a-f0-9]{12}\b/i,
    );
    await writeFile(
      blobPath,
      safeStorage.encryptString(
        JSON.stringify({
          version: 1,
          kind: "imap_password",
          username: "marcos@example.com",
          password: "secret",
          injected: true,
        }),
      ),
      { mode: 0o600 },
    );
    await expect(vault.get(accountId)).rejects.toThrow(
      /get .*\b[a-f0-9]{12}\b/i,
    );
  });

  it("rejects encrypted blobs copied between accounts without leaking credentials", async () => {
    const { directory, vault } = await createVault();
    const sourceAccount = "source-account";
    const targetAccount = "target-account";
    await vault.set(sourceAccount, {
      version: 1,
      kind: "imap_password",
      username: "source-user@example.com",
      password: "source-password",
    });
    await vault.set(targetAccount, {
      version: 1,
      kind: "oauth",
      username: "target-user@example.com",
      accessToken: "target-access-token",
    });
    const sourcePath = path.join(
      directory,
      `${createHash("sha256").update(sourceAccount).digest("hex")}.enc`,
    );
    const targetPath = path.join(
      directory,
      `${createHash("sha256").update(targetAccount).digest("hex")}.enc`,
    );
    await writeFile(targetPath, await readFile(sourcePath), { mode: 0o600 });

    const error = await vault
      .get(targetAccount)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/get .*\b[a-f0-9]{12}\b/i);
    expect((error as Error).message).not.toMatch(
      /source-user|source-password|target-user|target-access-token/i,
    );
  });

  it("does not touch storage when encryption is unavailable", async () => {
    const safeStorage = new FakeSafeStorage();
    safeStorage.available = false;
    const { directory, vault } = await createVault(safeStorage);

    await expect(
      vault.set("unavailable-account", {
        version: 1,
        kind: "imap_password",
        username: "marcos@example.com",
        password: "secret",
      }),
    ).rejects.toThrow(/set .*\b[a-f0-9]{12}\b/i);
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid credentials before creating a vault directory", async () => {
    const { directory, vault } = await createVault();

    await expect(
      vault.set("invalid-credential", {
        version: 1,
        kind: "imap_password",
        username: "   ",
        password: "secret",
        unexpected: true,
      } as never),
    ).rejects.toThrow(/set .*\b[a-f0-9]{12}\b/i);
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps has ciphertext-only, makes delete idempotent, and does not leak decrypt errors", async () => {
    const { safeStorage, vault } = await createVault();
    const accountId = "lifecycle-account";

    expect(await vault.has(accountId)).toBe(false);
    await vault.set(accountId, {
      version: 1,
      kind: "oauth",
      username: "marcos@example.com",
      accessToken: "access-token",
    });
    safeStorage.decryptError = new Error("access-token must stay private");
    expect(await vault.has(accountId)).toBe(true);
    await expect(vault.get(accountId)).rejects.toThrow(
      /get .*\b[a-f0-9]{12}\b/i,
    );
    await expect(vault.get(accountId)).rejects.not.toThrow(/access-token/);
    await expect(vault.delete(accountId)).resolves.toBeUndefined();
    await expect(vault.delete(accountId)).resolves.toBeUndefined();
    expect(await vault.has(accountId)).toBe(false);
    expect(await vault.get(accountId)).toBeNull();
  });
});
