BEGIN IMMEDIATE;

CREATE TABLE kanban_card_events_v24 (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES kanban_cards(id),
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('created', 'moved', 'assigned', 'updated')),
  idempotency_key TEXT NOT NULL UNIQUE,
  delta_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(card_id, sequence)
);

INSERT INTO kanban_card_events_v24
SELECT id, card_id, sequence, kind, idempotency_key, delta_json, state_hash, occurred_at
FROM kanban_card_events;

DROP TABLE kanban_card_events;
ALTER TABLE kanban_card_events_v24 RENAME TO kanban_card_events;
CREATE INDEX kanban_card_events_card_sequence_idx
  ON kanban_card_events(card_id, sequence);

PRAGMA user_version = 24;
COMMIT;
