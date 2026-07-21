BEGIN IMMEDIATE;

ALTER TABLE inbox_outgoing_settings
  ADD COLUMN from_addresses_json TEXT NOT NULL DEFAULT '[]';

PRAGMA user_version = 16;
COMMIT;
