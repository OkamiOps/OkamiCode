import type { Database } from "../db/connection";

export interface OutgoingSettings {
  host: string;
  port: number;
  secure: boolean;
  fromAddresses: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveOutgoingSettingsInput {
  accountId: string;
  host: string;
  port: number;
  secure: boolean;
  fromAddresses?: string[];
}

export class InboxOutgoingSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxOutgoingSettingsError";
  }
}

export class InboxOutgoingSettingsAccountNotFoundError extends InboxOutgoingSettingsError {
  constructor() {
    super("Inbox account was not found");
    this.name = "InboxOutgoingSettingsAccountNotFoundError";
  }
}

interface OutgoingSettingsRow {
  host: string;
  port: number;
  secure: number;
  from_addresses_json: string;
  created_at: string;
  updated_at: string;
}

export class InboxOutgoingSettingsService {
  constructor(
    private readonly dependencies: { db: Database; clock?: () => string },
  ) {}

  get(accountId: string): OutgoingSettings | null {
    try {
      const row = this.dependencies.db
        .prepare(
          `SELECT host, port, secure, from_addresses_json, created_at, updated_at
           FROM inbox_outgoing_settings WHERE account_id = ?`,
        )
        .get(accountId) as OutgoingSettingsRow | undefined;
      return row ? toSettings(row) : null;
    } catch {
      throw new InboxOutgoingSettingsError(
        "Outgoing mail configuration is unavailable",
      );
    }
  }

  save(input: SaveOutgoingSettingsInput): OutgoingSettings {
    const now = (this.dependencies.clock ?? (() => new Date().toISOString()))();
    try {
      return this.dependencies.db.transaction(() => {
        const account = this.dependencies.db
          .prepare("SELECT address FROM connector_accounts WHERE id = ?")
          .get(input.accountId) as { address: string } | undefined;
        if (!account) throw new InboxOutgoingSettingsAccountNotFoundError();
        const normalized = normalize(input, account.address);
        this.dependencies.db
          .prepare(
            `INSERT INTO inbox_outgoing_settings
             (account_id, host, port, secure, from_addresses_json, created_at, updated_at)
             VALUES (@accountId, @host, @port, @secure, @fromAddressesJson, @createdAt, @updatedAt)
             ON CONFLICT(account_id) DO UPDATE SET
               host = excluded.host,
               port = excluded.port,
               secure = excluded.secure,
               from_addresses_json = excluded.from_addresses_json,
               updated_at = excluded.updated_at`,
          )
          .run({
            ...normalized,
            secure: normalized.secure ? 1 : 0,
            fromAddressesJson: JSON.stringify(normalized.fromAddresses),
            createdAt: now,
            updatedAt: now,
          });
        return this.get(normalized.accountId) as OutgoingSettings;
      })();
    } catch (error) {
      if (error instanceof InboxOutgoingSettingsError) throw error;
      throw new InboxOutgoingSettingsError(
        "Outgoing mail configuration could not be saved",
      );
    }
  }
}

function normalize(input: SaveOutgoingSettingsInput, accountAddress: string) {
  const host =
    typeof input.host === "string" ? input.host.trim().toLowerCase() : "";
  if (!host || host.length > 255) {
    throw new InboxOutgoingSettingsError(
      "Outgoing mail configuration is invalid",
    );
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new InboxOutgoingSettingsError(
      "Outgoing mail configuration is invalid",
    );
  }
  if (typeof input.secure !== "boolean" || !input.accountId.trim()) {
    throw new InboxOutgoingSettingsError(
      "Outgoing mail configuration is invalid",
    );
  }
  const fromAddresses = normalizeFromAddresses(
    input.fromAddresses ?? [],
    accountAddress,
  );
  return { ...input, host, fromAddresses };
}

function toSettings(row: OutgoingSettingsRow): OutgoingSettings {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure === 1,
    fromAddresses: parseFromAddresses(row.from_addresses_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeFromAddresses(values: string[], accountAddress: string) {
  if (!Array.isArray(values) || values.length > 50) {
    throw new InboxOutgoingSettingsError(
      "Outgoing mail configuration is invalid",
    );
  }
  const primary = accountAddress.trim().toLowerCase();
  const unique = new Set<string>();
  for (const value of values) {
    const address = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!isEmailAddress(address)) {
      throw new InboxOutgoingSettingsError(
        "Outgoing mail configuration is invalid",
      );
    }
    if (address !== primary) unique.add(address);
  }
  return [...unique];
}

function parseFromAddresses(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length > 50 ||
    !parsed.every((address) =>
      typeof address === "string" ? isEmailAddress(address) : false,
    )
  ) {
    throw new Error("invalid sender aliases");
  }
  return [...new Set(parsed)];
}

function isEmailAddress(value: string) {
  return value.length <= 320 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value);
}
