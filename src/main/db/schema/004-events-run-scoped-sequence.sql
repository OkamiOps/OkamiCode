-- The projector's sequence restarts at 0 every run, but events carried
-- UNIQUE(lane_id, sequence): with INSERT OR IGNORE, every run after a
-- lane's first was silently dropped. Sequence is per-run — scope the
-- constraint accordingly.
CREATE TABLE events_migrated (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  lane_id TEXT NOT NULL REFERENCES runtime_lanes(id), run_id TEXT NOT NULL REFERENCES runs(id),
  sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL, kind TEXT NOT NULL,
  native_event_id TEXT, payload_json TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);
INSERT INTO events_migrated
  SELECT id, task_id, lane_id, run_id, sequence, occurred_at, kind,
         native_event_id, payload_json
  FROM events;
DROP TABLE events;
ALTER TABLE events_migrated RENAME TO events;
CREATE UNIQUE INDEX events_native_id_idx ON events(lane_id, native_event_id)
  WHERE native_event_id IS NOT NULL;
CREATE INDEX events_run_idx ON events(run_id, sequence);
CREATE INDEX events_task_time_idx ON events(task_id, occurred_at);

PRAGMA user_version = 4;
