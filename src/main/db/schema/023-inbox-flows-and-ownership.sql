BEGIN IMMEDIATE;

ALTER TABLE inbox_threads
  ADD COLUMN folder TEXT NOT NULL DEFAULT 'inbox'
  CHECK(folder IN ('inbox', 'spam', 'trash'));

CREATE INDEX inbox_threads_folder_last_message_idx
  ON inbox_threads(folder, last_message_at DESC, id DESC);

CREATE TABLE inbox_agent_assignments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE REFERENCES inbox_threads(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL UNIQUE REFERENCES inbox_thread_actions(id) ON DELETE CASCADE,
  lane_id TEXT NOT NULL,
  card_id TEXT NOT NULL REFERENCES kanban_cards(id),
  status TEXT NOT NULL CHECK(status IN ('watching', 'working', 'awaiting_human', 'resolved')),
  last_observed_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO inbox_agent_assignments
  (id, thread_id, action_id, lane_id, card_id, status,
   last_observed_message_at, created_at, updated_at)
SELECT
  'assignment:' || action.id,
  action.thread_id,
  action.id,
  card.lane_id,
  card.id,
  'watching',
  thread.last_message_at,
  action.created_at,
  action.created_at
FROM inbox_thread_actions action
JOIN kanban_cards card ON card.id = action.card_id
JOIN inbox_threads thread ON thread.id = action.thread_id
WHERE action.action_kind = 'kanban_delegate'
  AND card.lane_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM inbox_thread_actions newer
    WHERE newer.thread_id = action.thread_id
      AND newer.action_kind = 'kanban_delegate'
      AND (newer.created_at > action.created_at OR
           (newer.created_at = action.created_at AND newer.id > action.id))
  );

UPDATE kanban_cards
SET activation_policy = 'relevant_change'
WHERE id IN (SELECT card_id FROM inbox_agent_assignments);

CREATE INDEX inbox_agent_assignments_status_updated_idx
  ON inbox_agent_assignments(status, updated_at DESC);

PRAGMA user_version = 23;
COMMIT;
