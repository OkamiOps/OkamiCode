BEGIN IMMEDIATE;

CREATE TABLE inbox_reply_dismissals (
  outbox_id TEXT PRIMARY KEY REFERENCES external_outbox(id) ON DELETE CASCADE,
  source_thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL
);

CREATE INDEX inbox_reply_dismissals_thread_id_idx
  ON inbox_reply_dismissals(source_thread_id);

PRAGMA user_version = 15;
COMMIT;
