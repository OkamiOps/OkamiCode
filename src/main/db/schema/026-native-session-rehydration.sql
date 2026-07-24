BEGIN IMMEDIATE;

ALTER TABLE native_session_bindings
ADD COLUMN migration_from_native_session_id TEXT;

ALTER TABLE native_session_bindings
ADD COLUMN rehydration_required INTEGER NOT NULL DEFAULT 0
CHECK(rehydration_required IN (0, 1));

PRAGMA user_version = 26;
COMMIT;
