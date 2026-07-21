BEGIN IMMEDIATE;

CREATE TABLE inbox_outgoing_settings (
  account_id TEXT PRIMARY KEY REFERENCES connector_accounts(id) ON DELETE CASCADE,
  host TEXT NOT NULL CHECK(length(trim(host)) BETWEEN 1 AND 255),
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  secure INTEGER NOT NULL CHECK(secure IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 12;
COMMIT;
