BEGIN IMMEDIATE;

ALTER TABLE inbox_messages ADD COLUMN remote_seen_override INTEGER
  CHECK (remote_seen_override IN (0, 1) OR remote_seen_override IS NULL);

PRAGMA user_version = 22;
COMMIT;
