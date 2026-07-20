BEGIN IMMEDIATE;

CREATE TABLE inbox_account_settings (
  account_id TEXT PRIMARY KEY REFERENCES connector_accounts(id) ON DELETE CASCADE,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  secure INTEGER NOT NULL CHECK(secure IN (0, 1)),
  mailbox TEXT NOT NULL,
  max_initial_messages INTEGER NOT NULL CHECK(max_initial_messages BETWEEN 1 AND 500),
  max_message_bytes INTEGER NOT NULL CHECK(max_message_bytes BETWEEN 1 AND 10485760),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 10;
COMMIT;
