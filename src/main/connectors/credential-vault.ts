import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(blob: Buffer): string;
}

export type ImapPasswordCredential = {
  version: 1;
  kind: "imap_password";
  username: string;
  password: string;
};

export type OAuthCredential = {
  version: 1;
  kind: "oauth";
  username: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  google?: {
    clientId: string;
    clientSecret?: string;
    scopes: string[];
  };
};

export type ConnectorCredential = ImapPasswordCredential | OAuthCredential;

type Operation = "set" | "get" | "has" | "delete";

export class ConnectorCredentialVault {
  constructor(
    private readonly directory: string,
    private readonly safeStorage: SafeStorage,
  ) {}

  async set(accountId: string, credential: ConnectorCredential): Promise<void> {
    const opaqueId = opaqueAccountId(accountId);
    try {
      this.ensureEncryptionAvailable();
      const destination = this.destinationFor(accountId);
      const validated = validateCredential(credential);
      const encrypted = this.safeStorage.encryptString(
        JSON.stringify({
          version: 1,
          accountBinding: hashAccountId(accountId),
          credential: validated,
        }),
      );
      await this.writeAtomically(destination, encrypted);
    } catch {
      throw publicError("set", opaqueId);
    }
  }

  async get(accountId: string): Promise<ConnectorCredential | null> {
    const opaqueId = opaqueAccountId(accountId);
    try {
      this.ensureEncryptionAvailable();
      const destination = this.destinationFor(accountId);
      let encrypted: Buffer;
      try {
        encrypted = await readFile(destination);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      const credential = validateEnvelope(
        JSON.parse(this.safeStorage.decryptString(encrypted)),
        hashAccountId(accountId),
      );
      return { ...credential };
    } catch {
      throw publicError("get", opaqueId);
    }
  }

  async has(accountId: string): Promise<boolean> {
    const opaqueId = opaqueAccountId(accountId);
    try {
      this.ensureEncryptionAvailable();
      const destination = this.destinationFor(accountId);
      try {
        return (await stat(destination)).isFile();
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    } catch {
      throw publicError("has", opaqueId);
    }
  }

  async delete(accountId: string): Promise<void> {
    const opaqueId = opaqueAccountId(accountId);
    try {
      this.ensureEncryptionAvailable();
      try {
        await unlink(this.destinationFor(accountId));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    } catch {
      throw publicError("delete", opaqueId);
    }
  }

  private ensureEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error("unavailable");
  }

  private destinationFor(accountId: string): string {
    if (typeof accountId !== "string" || accountId.trim().length === 0) {
      throw new Error("invalid account");
    }
    return path.join(this.directory, `${hashAccountId(accountId)}.enc`);
  }

  private async writeAtomically(
    destination: string,
    encrypted: Buffer,
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    let temporary: string | undefined;
    try {
      temporary = path.join(
        this.directory,
        `.${path.basename(destination)}.${randomUUID()}.tmp`,
      );
      await writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, destination);
      temporary = undefined;
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
  }
}

function validateCredential(value: unknown): ConnectorCredential {
  if (!isPlainRecord(value) || value.version !== 1) throw new Error("invalid");
  if (value.kind === "imap_password") {
    assertExactKeys(value, ["version", "kind", "username", "password"]);
    assertNonEmptyString(value.username);
    assertNonEmptyString(value.password);
    return {
      version: 1,
      kind: "imap_password",
      username: value.username,
      password: value.password,
    };
  }
  if (value.kind === "oauth") {
    assertExactKeys(value, [
      "version",
      "kind",
      "username",
      "accessToken",
      "refreshToken",
      "expiresAt",
      "google",
    ]);
    assertNonEmptyString(value.username);
    assertNonEmptyString(value.accessToken);
    if (Object.hasOwn(value, "refreshToken"))
      assertNonEmptyString(value.refreshToken);
    if (Object.hasOwn(value, "expiresAt"))
      assertNonEmptyString(value.expiresAt);
    const google = Object.hasOwn(value, "google")
      ? validateGoogleOAuthClient(value.google)
      : undefined;
    return {
      version: 1,
      kind: "oauth",
      username: value.username,
      accessToken: value.accessToken,
      ...(Object.hasOwn(value, "refreshToken")
        ? { refreshToken: value.refreshToken as string }
        : {}),
      ...(Object.hasOwn(value, "expiresAt")
        ? { expiresAt: value.expiresAt as string }
        : {}),
      ...(google ? { google } : {}),
    };
  }
  throw new Error("invalid");
}

function validateGoogleOAuthClient(value: unknown): {
  clientId: string;
  clientSecret?: string;
  scopes: string[];
} {
  if (!isPlainRecord(value)) throw new Error("invalid");
  assertExactKeys(value, ["clientId", "clientSecret", "scopes"]);
  assertNonEmptyString(value.clientId);
  if (Object.hasOwn(value, "clientSecret")) {
    assertNonEmptyString(value.clientSecret);
  }
  if (
    !Array.isArray(value.scopes) ||
    value.scopes.length === 0 ||
    value.scopes.length > 20 ||
    !value.scopes.every(
      (scope) => typeof scope === "string" && scope.trim().length > 0,
    )
  ) {
    throw new Error("invalid");
  }
  return {
    clientId: value.clientId,
    ...(Object.hasOwn(value, "clientSecret")
      ? { clientSecret: value.clientSecret as string }
      : {}),
    scopes: [...value.scopes],
  };
}

function validateEnvelope(
  value: unknown,
  expectedAccountBinding: string,
): ConnectorCredential {
  if (!isPlainRecord(value) || value.version !== 1) throw new Error("invalid");
  assertExactKeys(value, ["version", "accountBinding", "credential"]);
  if (value.accountBinding !== expectedAccountBinding)
    throw new Error("invalid");
  return validateCredential(value.credential);
}

function assertExactKeys(
  value: Record<PropertyKey, unknown>,
  permitted: readonly string[],
): void {
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !permitted.includes(key),
    )
  ) {
    throw new Error("invalid");
  }
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("invalid");
  }
}

function isPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hashAccountId(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex");
}

function opaqueAccountId(accountId: unknown): string {
  return createHash("sha256")
    .update(typeof accountId === "string" ? accountId : "invalid-account")
    .digest("hex")
    .slice(0, 12);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function publicError(operation: Operation, opaqueId: string): Error {
  return new Error(`Credential vault ${operation} failed (${opaqueId})`);
}
