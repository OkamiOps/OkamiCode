BEGIN IMMEDIATE;

CREATE TABLE inbox_thread_actions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  action_kind TEXT NOT NULL CHECK(action_kind IN ('kanban_manual', 'kanban_delegate')),
  request_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  card_id TEXT NOT NULL REFERENCES kanban_cards(id),
  created_at TEXT NOT NULL
);

CREATE INDEX inbox_thread_actions_thread_idx
  ON inbox_thread_actions(thread_id, created_at DESC);

PRAGMA user_version = 11;
COMMIT;
