-- The permission mode was only ever a UI label: lanes had nowhere to store it
-- and the CLI was always spawned with "manual".
ALTER TABLE runtime_lanes ADD COLUMN permission_mode TEXT;

PRAGMA user_version = 6;
