BEGIN IMMEDIATE;

CREATE TABLE calendar_linked_sources (
  source_id TEXT PRIMARY KEY REFERENCES calendar_sources(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES connector_accounts(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL CHECK(protocol IN ('caldav', 'ics')),
  calendar_url TEXT NOT NULL CHECK(length(trim(calendar_url)) BETWEEN 1 AND 4096),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, protocol, calendar_url)
);

CREATE INDEX calendar_linked_sources_account_id_idx
  ON calendar_linked_sources(account_id);

CREATE TRIGGER calendar_linked_source_delete_source
AFTER DELETE ON calendar_linked_sources
BEGIN
  DELETE FROM calendar_sources WHERE id = OLD.source_id;
END;

PRAGMA user_version = 14;
COMMIT;
