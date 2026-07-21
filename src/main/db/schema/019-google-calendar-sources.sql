BEGIN IMMEDIATE;

CREATE TABLE calendar_google_sources (
  source_id TEXT PRIMARY KEY REFERENCES calendar_sources(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE REFERENCES connector_accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX calendar_google_sources_account_id_idx
  ON calendar_google_sources(account_id);

CREATE TRIGGER calendar_google_source_delete_source
AFTER DELETE ON calendar_google_sources
BEGIN
  DELETE FROM calendar_sources WHERE id = OLD.source_id;
END;

PRAGMA user_version = 19;
COMMIT;
