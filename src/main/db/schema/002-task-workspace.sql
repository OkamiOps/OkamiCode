BEGIN IMMEDIATE;
ALTER TABLE tasks ADD COLUMN workspace_path TEXT;
PRAGMA user_version = 2;
COMMIT;
