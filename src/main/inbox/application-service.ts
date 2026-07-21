import type { ConnectorCredential } from "../connectors/credential-vault";
import type { Database } from "../db/connection";
import {
  ImapSyncError,
  type ImapAccountConfiguration,
  type ImapSyncInput,
} from "./imap-adapter";
import {
  InboxInvalidInputError,
  InboxService,
  type ApplyInboxSyncBatch,
  type ConnectorAccount,
  type InboxThread,
  type InboxThreadDetail,
  type InboxThreadPage,
  type InboxCalendarInvitation,
  type InboxAccountProvider,
  type ListInboxThreadsOptions,
  type SyncBatchCounts,
} from "./service";

const DEFAULT_MAILBOX = "INBOX";
const DEFAULT_INITIAL_MESSAGES = 100;
const DEFAULT_MESSAGE_BYTES = 2 * 1024 * 1024;
const AUTH_REQUIRED_ERROR =
  "Credentials are required to synchronize this account.";
const SYNC_FAILED_ERROR = "Synchronization failed. Please try again.";
const SYNC_INTERRUPTED_ERROR = "Sincronização interrompida. Tente novamente.";

export interface CredentialVault {
  set(accountId: string, credential: ConnectorCredential): Promise<void>;
  get(accountId: string): Promise<ConnectorCredential | null>;
  has(accountId: string): Promise<boolean>;
  delete(accountId: string): Promise<void>;
}

export interface ImapSyncer {
  sync(input: ImapSyncInput): Promise<ApplyInboxSyncBatch>;
}

export type CreateImapAdapter = (vault: CredentialVault) => ImapSyncer;

export interface AddImapAccountInput {
  provider: "gmail" | "imap" | "zoho";
  displayName: string;
  address: string;
  configuration: ImapAccountConfiguration;
  credential: ConnectorCredential;
}

export interface StoredImapAccountConfiguration {
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  maxInitialMessages: number;
  maxMessageBytes: number;
}

export interface InboxAccountSummary {
  account: ConnectorAccount;
  configuration: StoredImapAccountConfiguration;
  hasCredential: boolean;
}

export interface InboxSyncResult {
  account: ConnectorAccount;
  counts: SyncBatchCounts;
}

export interface InboxApplicationServiceOptions {
  db: Database;
  vault: CredentialVault;
  createAdapter: CreateImapAdapter;
  createId: () => string;
  clock: () => Date;
  calendarInvitations?: {
    import(input: {
      accountId: string;
      accountDisplayName: string;
      accountAddress: string;
      invitations: InboxCalendarInvitation[];
      syncedAt: string;
    }): void | Promise<void>;
  };
}

export class InboxApplicationError extends Error {
  constructor(message = "Inbox operation failed.") {
    super(message);
    this.name = "InboxApplicationError";
  }
}

type AccountRow = {
  id: string;
  provider: InboxAccountProvider;
  display_name: string;
  address: string;
  status: ConnectorAccount["status"];
  sync_cursor: string | null;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type SettingsRow = {
  account_id: string;
  host: string;
  port: number;
  secure: number;
  mailbox: string;
  max_initial_messages: number;
  max_message_bytes: number;
};

export class InboxApplicationService {
  private readonly inbox: InboxService;
  private readonly inFlight = new Map<string, Promise<InboxSyncResult>>();

  constructor(private readonly options: InboxApplicationServiceOptions) {
    this.inbox = new InboxService(options.db);
    this.recoverInterruptedSyncs();
  }

  async addImapAccount(
    input: AddImapAccountInput,
  ): Promise<InboxAccountSummary> {
    const normalized = validateAddInput(input);
    const accountId = this.options.createId();
    const now = this.options.clock().toISOString();
    try {
      await this.options.vault.set(
        accountId,
        normalizeCredential(normalized.provider, input.credential),
      );
    } catch {
      throw new InboxApplicationError();
    }

    try {
      this.options.db.transaction(() => {
        this.options.db
          .prepare(
            `INSERT INTO connector_accounts
             (id, provider, display_name, address, status, sync_cursor, last_error,
              last_synced_at, created_at, updated_at)
             VALUES (@id, @provider, @displayName, @address, 'connected', NULL, NULL,
                     NULL, @createdAt, @updatedAt)`,
          )
          .run({
            id: accountId,
            provider: normalized.provider,
            displayName: normalized.displayName,
            address: normalized.address,
            createdAt: now,
            updatedAt: now,
          });
        this.options.db
          .prepare(
            `INSERT INTO inbox_account_settings
             (account_id, host, port, secure, mailbox, max_initial_messages,
              max_message_bytes, created_at, updated_at)
             VALUES (@accountId, @host, @port, @secure, @mailbox, @maxInitialMessages,
                     @maxMessageBytes, @createdAt, @updatedAt)`,
          )
          .run({
            accountId,
            ...normalized.configuration,
            secure: normalized.configuration.secure ? 1 : 0,
            createdAt: now,
            updatedAt: now,
          });
        const outgoing = inferredOutgoingConfiguration(
          normalized.configuration.host,
        );
        if (outgoing) {
          this.options.db
            .prepare(
              `INSERT INTO inbox_outgoing_settings
               (account_id, host, port, secure, from_addresses_json,
                created_at, updated_at)
               VALUES (@accountId, @host, @port, @secure, '[]',
                       @createdAt, @updatedAt)`,
            )
            .run({
              accountId,
              ...outgoing,
              secure: outgoing.secure ? 1 : 0,
              createdAt: now,
              updatedAt: now,
            });
        }
      })();
    } catch {
      try {
        await this.options.vault.delete(accountId);
      } catch {
        // The database transaction rolled back; no secret details enter the public error.
      }
      throw new InboxApplicationError();
    }
    return this.requireSummary(accountId, true);
  }

  async listAccounts(): Promise<InboxAccountSummary[]> {
    const rows = this.options.db
      .prepare(
        `SELECT a.*, s.account_id, s.host, s.port, s.secure, s.mailbox,
                s.max_initial_messages, s.max_message_bytes
         FROM connector_accounts a
         JOIN inbox_account_settings s ON s.account_id = a.id
         ORDER BY a.created_at ASC, a.provider ASC, a.address ASC, a.id ASC`,
      )
      .all() as Array<AccountRow & SettingsRow>;
    const result: InboxAccountSummary[] = [];
    for (const row of rows) {
      let hasCredential: boolean;
      try {
        hasCredential = await this.options.vault.has(row.id);
      } catch {
        throw new InboxApplicationError();
      }
      result.push(summaryFromRow(row, hasCredential));
    }
    return result;
  }

  async removeAccount(
    accountId: string,
  ): Promise<{ accountId: string; removed: true }> {
    if (!this.findAccount(accountId)) throw new InboxApplicationError();
    try {
      await this.options.vault.delete(accountId);
    } catch {
      throw new InboxApplicationError();
    }
    try {
      this.options.db
        .prepare("DELETE FROM connector_accounts WHERE id = ?")
        .run(accountId);
    } catch {
      throw new InboxApplicationError();
    }
    return { accountId, removed: true };
  }

  syncAccount(accountId: string): Promise<InboxSyncResult> {
    const existing = this.inFlight.get(accountId);
    if (existing) return existing;
    const account = this.findAccount(accountId);
    const configuration = this.findConfiguration(accountId);
    if (!account || !configuration)
      return Promise.reject(new InboxApplicationError());
    const operation = this.executeSync(account, configuration).finally(() => {
      this.inFlight.delete(accountId);
    });
    this.inFlight.set(accountId, operation);
    return operation;
  }

  async updateCredentialAndSync(
    accountId: string,
    credential: ConnectorCredential,
  ): Promise<InboxSyncResult> {
    const account = this.findAccount(accountId);
    if (!account || !this.findConfiguration(accountId)) {
      throw new InboxApplicationError();
    }
    try {
      await this.options.vault.set(
        accountId,
        normalizeCredential(account.provider, credential),
      );
      this.setPublicStatus(accountId, "connected", null);
    } catch {
      throw new InboxApplicationError();
    }
    return this.syncAccount(accountId);
  }

  listThreads(options?: ListInboxThreadsOptions): InboxThreadPage {
    return this.inbox.listThreads(options);
  }

  getThread(id: string): InboxThreadDetail {
    return this.inbox.getThread(id);
  }

  markThreadRead(id: string): InboxThread {
    return this.inbox.markThreadRead(id);
  }

  private async executeSync(
    account: ConnectorAccount,
    configuration: StoredImapAccountConfiguration,
  ): Promise<InboxSyncResult> {
    let stage:
      | "credential"
      | "imap"
      | "persist_messages"
      | "import_calendar"
      | "complete" = "credential";
    let hasCredential: boolean;
    try {
      hasCredential = await this.options.vault.has(account.id);
    } catch {
      this.setPublicStatus(account.id, "degraded", SYNC_FAILED_ERROR);
      throw new InboxApplicationError(SYNC_FAILED_ERROR);
    }
    if (!hasCredential) {
      this.setPublicStatus(account.id, "auth_required", AUTH_REQUIRED_ERROR);
      throw new InboxApplicationError(AUTH_REQUIRED_ERROR);
    }

    try {
      this.setPublicStatus(account.id, "syncing", null);
      stage = "imap";
      const batch = await this.options.createAdapter(this.options.vault).sync({
        account,
        configuration,
      });
      stage = "persist_messages";
      const counts = this.inbox.applySyncBatch(batch);
      if (this.options.calendarInvitations) {
        stage = "import_calendar";
        await this.options.calendarInvitations.import({
          accountId: account.id,
          accountDisplayName: account.displayName,
          accountAddress: account.address,
          invitations: batch.calendarInvitations ?? [],
          syncedAt: batch.syncedAt,
        });
      }
      stage = "complete";
      const connected = this.setPublicStatus(account.id, "connected", null);
      return { account: connected, counts };
    } catch (cause) {
      console.warn("[okami] Inbox synchronization boundary failed", {
        accountId: account.id,
        provider: account.provider,
        stage,
        errorName: cause instanceof Error ? cause.name : "UnknownError",
        errorCode: inboxErrorCode(cause),
        validation:
          cause instanceof InboxInvalidInputError ? cause.message : null,
      });
      if (cause instanceof ImapSyncError && cause.code === "auth_required") {
        this.setPublicStatus(account.id, "auth_required", cause.message);
        throw new InboxApplicationError(cause.message);
      }
      this.setPublicStatus(account.id, "degraded", SYNC_FAILED_ERROR);
      throw new InboxApplicationError(SYNC_FAILED_ERROR);
    }
  }

  private requireSummary(
    accountId: string,
    hasCredential: boolean,
  ): InboxAccountSummary {
    const account = this.findAccount(accountId);
    const configuration = this.findConfiguration(accountId);
    if (!account || !configuration) throw new InboxApplicationError();
    return { account, configuration, hasCredential };
  }

  private recoverInterruptedSyncs(): void {
    this.options.db
      .prepare(
        `UPDATE connector_accounts
            SET status = 'degraded', last_error = @lastError,
                updated_at = @updatedAt
          WHERE status = 'syncing'`,
      )
      .run({
        lastError: SYNC_INTERRUPTED_ERROR,
        updatedAt: this.options.clock().toISOString(),
      });
  }

  private findAccount(id: string): ConnectorAccount | undefined {
    const row = this.options.db
      .prepare("SELECT * FROM connector_accounts WHERE id = ?")
      .get(id) as AccountRow | undefined;
    return row ? accountFromRow(row) : undefined;
  }

  private findConfiguration(
    id: string,
  ): StoredImapAccountConfiguration | undefined {
    const row = this.options.db
      .prepare("SELECT * FROM inbox_account_settings WHERE account_id = ?")
      .get(id) as SettingsRow | undefined;
    return row ? configurationFromRow(row) : undefined;
  }

  private setPublicStatus(
    id: string,
    status: ConnectorAccount["status"],
    lastError: string | null,
  ): ConnectorAccount {
    try {
      const result = this.options.db
        .prepare(
          `UPDATE connector_accounts
           SET status = @status, last_error = @lastError, updated_at = @updatedAt
           WHERE id = @id`,
        )
        .run({
          id,
          status,
          lastError,
          updatedAt: this.options.clock().toISOString(),
        });
      if (result.changes !== 1) throw new Error("missing");
      const account = this.findAccount(id);
      if (!account) throw new Error("missing");
      return account;
    } catch {
      throw new InboxApplicationError();
    }
  }
}

function inboxErrorCode(cause: unknown): string | null {
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
  return typeof cause.code === "string" ? cause.code : null;
}

function inferredOutgoingConfiguration(incomingHost: string) {
  const host = incomingHost.trim().toLowerCase();
  if (host === "imap.hostinger.com") {
    return { host: "smtp.hostinger.com", port: 465, secure: true };
  }
  if (host === "imap.gmail.com") {
    return { host: "smtp.gmail.com", port: 465, secure: true };
  }
  return null;
}

function validateAddInput(input: AddImapAccountInput): {
  provider: "gmail" | "imap" | "zoho";
  displayName: string;
  address: string;
  configuration: StoredImapAccountConfiguration;
} {
  if (!input || !["gmail", "imap", "zoho"].includes(input.provider))
    throw new InboxApplicationError();
  const displayName = text(input.displayName);
  const address = text(input.address).toLowerCase();
  const configuration = validateConfiguration(input.configuration);
  if (!displayName || !address) throw new InboxApplicationError();
  return { provider: input.provider, displayName, address, configuration };
}

function validateConfiguration(
  value: ImapAccountConfiguration,
): StoredImapAccountConfiguration {
  if (
    !value ||
    !text(value.host) ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65535 ||
    typeof value.secure !== "boolean"
  )
    throw new InboxApplicationError();
  const mailbox = text(value.mailbox ?? DEFAULT_MAILBOX);
  const maxInitialMessages =
    value.maxInitialMessages ?? DEFAULT_INITIAL_MESSAGES;
  const maxMessageBytes = value.maxMessageBytes ?? DEFAULT_MESSAGE_BYTES;
  if (
    !mailbox ||
    !Number.isInteger(maxInitialMessages) ||
    maxInitialMessages < 1 ||
    maxInitialMessages > 500 ||
    !Number.isInteger(maxMessageBytes) ||
    maxMessageBytes < 1 ||
    maxMessageBytes > 10 * 1024 * 1024
  )
    throw new InboxApplicationError();
  return {
    host: text(value.host),
    port: value.port,
    secure: value.secure,
    mailbox,
    maxInitialMessages,
    maxMessageBytes,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCredential(
  provider: InboxAccountProvider,
  credential: ConnectorCredential,
): ConnectorCredential {
  if (provider !== "gmail" || credential.kind !== "imap_password") {
    return credential;
  }
  return {
    ...credential,
    username: credential.username.trim(),
    password: credential.password.replace(/\s+/gu, ""),
  };
}

function accountFromRow(row: AccountRow): ConnectorAccount {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    address: row.address,
    status: row.status,
    syncCursor: row.sync_cursor,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function configurationFromRow(
  row: SettingsRow,
): StoredImapAccountConfiguration {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure === 1,
    mailbox: row.mailbox,
    maxInitialMessages: row.max_initial_messages,
    maxMessageBytes: row.max_message_bytes,
  };
}

function summaryFromRow(
  row: AccountRow & SettingsRow,
  hasCredential: boolean,
): InboxAccountSummary {
  return {
    account: accountFromRow(row),
    configuration: configurationFromRow(row),
    hasCredential,
  };
}
