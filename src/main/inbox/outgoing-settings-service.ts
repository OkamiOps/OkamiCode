import type { Database } from "../db/connection";

export interface OutgoingSettings {
  host: string;
  port: number;
  secure: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveOutgoingSettingsInput {
  accountId: string;
  host: string;
  port: number;
  secure: boolean;
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
          `SELECT host, port, secure, created_at, updated_at
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
    const normalized = normalize(input);
    const now = (this.dependencies.clock ?? (() => new Date().toISOString()))();
    try {
      return this.dependencies.db.transaction(() => {
        const account = this.dependencies.db
          .prepare("SELECT 1 FROM connector_accounts WHERE id = ?")
          .get(normalized.accountId);
        if (!account) throw new InboxOutgoingSettingsAccountNotFoundError();
        this.dependencies.db
          .prepare(
            `INSERT INTO inbox_outgoing_settings
             (account_id, host, port, secure, created_at, updated_at)
             VALUES (@accountId, @host, @port, @secure, @createdAt, @updatedAt)
             ON CONFLICT(account_id) DO UPDATE SET
               host = excluded.host,
               port = excluded.port,
               secure = excluded.secure,
               updated_at = excluded.updated_at`,
          )
          .run({
            ...normalized,
            secure: normalized.secure ? 1 : 0,
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

function normalize(input: SaveOutgoingSettingsInput) {
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
  return { ...input, host };
}

function toSettings(row: OutgoingSettingsRow): OutgoingSettings {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
