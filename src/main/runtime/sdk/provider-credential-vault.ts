import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { SafeStorage } from "../../connectors/credential-vault";

export type TokenPlanProvider = "mimo" | "minimax";

export interface TokenPlanCredential {
  token: string;
  baseUrl?: string;
}

interface StoredCredential {
  version: 1;
  provider: TokenPlanProvider;
  entitlement: "token_plan";
  token: string;
  baseUrl?: string;
}

export class ProviderCredentialVault {
  constructor(
    private readonly directory: string,
    private readonly safeStorage: SafeStorage,
  ) {}

  async set(
    provider: TokenPlanProvider,
    credential: TokenPlanCredential,
  ): Promise<void> {
    const stored = validate(provider, credential);
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Provider credential encryption is unavailable");
    }
    const encrypted = this.safeStorage.encryptString(JSON.stringify(stored));
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const destination = this.destination(provider);
    const temporary = path.join(
      this.directory,
      `.${provider}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, destination);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async get(provider: TokenPlanProvider): Promise<TokenPlanCredential | null> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("Provider credential encryption is unavailable");
    }
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.destination(provider));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new Error("Provider credential could not be read");
    }
    try {
      const stored = validateStored(
        JSON.parse(this.safeStorage.decryptString(encrypted)),
        provider,
      );
      return {
        token: stored.token,
        ...(stored.baseUrl ? { baseUrl: stored.baseUrl } : {}),
      };
    } catch {
      throw new Error("Provider credential could not be decrypted");
    }
  }

  async has(provider: TokenPlanProvider): Promise<boolean> {
    return (await this.get(provider)) !== null;
  }

  async delete(provider: TokenPlanProvider): Promise<void> {
    await unlink(this.destination(provider)).catch((error: unknown) => {
      if (!isNotFound(error))
        throw new Error("Provider credential could not be deleted");
    });
  }

  private destination(provider: TokenPlanProvider): string {
    return path.join(this.directory, `${provider}.enc`);
  }
}

export class VaultTokenPlanSource {
  constructor(
    private readonly provider: TokenPlanProvider,
    private readonly vault: Pick<ProviderCredentialVault, "get">,
  ) {}

  async get(): Promise<string | null> {
    return (await this.vault.get(this.provider))?.token ?? null;
  }

  async baseUrl(): Promise<string | null> {
    return (await this.vault.get(this.provider))?.baseUrl ?? null;
  }
}

function validate(
  provider: TokenPlanProvider,
  credential: TokenPlanCredential,
): StoredCredential {
  const token = credential.token.trim();
  if (
    (provider === "mimo" && !token.startsWith("tp-")) ||
    (provider === "minimax" && !token.startsWith("sk-cp-"))
  ) {
    throw new Error(`${provider} requires its dedicated Token Plan key`);
  }
  const baseUrl =
    provider === "mimo"
      ? validateMimoBaseUrl(credential.baseUrl)
      : validateOptionalHttpsUrl(credential.baseUrl);
  return {
    version: 1,
    provider,
    entitlement: "token_plan",
    token,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

function validateStored(
  value: unknown,
  provider: TokenPlanProvider,
): StoredCredential {
  if (!isRecord(value)) throw new Error("invalid");
  if (
    value.version !== 1 ||
    value.provider !== provider ||
    value.entitlement !== "token_plan" ||
    typeof value.token !== "string"
  ) {
    throw new Error("invalid");
  }
  return validate(provider, {
    token: value.token,
    ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
  });
}

function validateMimoBaseUrl(value: string | undefined): string {
  const url = validateOptionalHttpsUrl(value);
  if (!url) throw new Error("MiMo Token Plan requires its Base URL");
  const hostname = new URL(url).hostname;
  if (
    !hostname.startsWith("token-plan-") ||
    !hostname.endsWith(".xiaomimimo.com")
  ) {
    throw new Error("MiMo requires a Token Plan Base URL");
  }
  return url;
}

function validateOptionalHttpsUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("HTTPS is required");
  return url.toString().replace(/\/$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
