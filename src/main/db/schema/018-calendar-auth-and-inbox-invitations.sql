BEGIN IMMEDIATE;

ALTER TABLE calendar_linked_sources
  ADD COLUMN authentication TEXT NOT NULL DEFAULT 'account'
  CHECK(authentication IN ('account', 'none'));

CREATE TABLE calendar_inbox_sources (
  source_id TEXT PRIMARY KEY REFERENCES calendar_sources(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE REFERENCES connector_accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX calendar_inbox_sources_account_id_idx
  ON calendar_inbox_sources(account_id);

CREATE TRIGGER calendar_inbox_source_delete_source
AFTER DELETE ON calendar_inbox_sources
BEGIN
  DELETE FROM calendar_sources WHERE id = OLD.source_id;
END;

PRAGMA user_version = 18;
COMMIT;
