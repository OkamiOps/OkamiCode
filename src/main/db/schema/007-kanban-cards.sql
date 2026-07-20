BEGIN IMMEDIATE;

CREATE TABLE kanban_cards (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('backlog', 'in_progress', 'review', 'done')),
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('human', 'lane')),
  lane_id TEXT,
  activation_policy TEXT NOT NULL CHECK(activation_policy IN ('manual', 'relevant_change', 'status_transition')),
  position REAL NOT NULL,
  state_hash TEXT NOT NULL,
  last_processed_hash TEXT NOT NULL,
  last_processed_cursor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX kanban_cards_task_position_idx ON kanban_cards(task_id, position, id);
CREATE INDEX kanban_cards_lane_idx ON kanban_cards(lane_id) WHERE lane_id IS NOT NULL;

CREATE TABLE kanban_card_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES kanban_cards(id),
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('created', 'moved', 'assigned')),
  idempotency_key TEXT NOT NULL UNIQUE,
  delta_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(card_id, sequence)
);
CREATE INDEX kanban_card_events_card_sequence_idx ON kanban_card_events(card_id, sequence);

PRAGMA user_version = 7;
COMMIT;
