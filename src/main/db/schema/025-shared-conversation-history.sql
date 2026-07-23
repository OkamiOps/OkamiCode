-- Earlier builds persisted user turns in the workbench conversation but kept
-- assistant completions only in the event stream. Backfill those completions
-- so every provider can inherit the same task conversation after an upgrade.
BEGIN IMMEDIATE;

INSERT OR IGNORE INTO conversations
  (id, task_id, kind, created_at, updated_at)
SELECT
  'workbench:' || tasks.id,
  tasks.id,
  'workbench',
  tasks.created_at,
  tasks.updated_at
FROM tasks
WHERE tasks.kind = 'workbench'
  AND EXISTS (
    SELECT 1 FROM events
    WHERE events.task_id = tasks.id
      AND events.kind = 'message_completed'
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.task_id = tasks.id
      AND conversations.kind = 'workbench'
  );

WITH candidates AS (
  SELECT
    events.id AS event_id,
    events.lane_id,
    events.occurred_at,
    runtime_lanes.runtime_kind,
    runtime_lanes.model,
    json_extract(events.payload_json, '$.text') AS body,
    (
      SELECT conversations.id
      FROM conversations
      WHERE conversations.task_id = events.task_id
        AND conversations.kind = 'workbench'
      ORDER BY conversations.created_at ASC, conversations.id ASC
      LIMIT 1
    ) AS conversation_id
  FROM events
  JOIN runtime_lanes ON runtime_lanes.id = events.lane_id
  WHERE events.kind = 'message_completed'
    AND json_type(events.payload_json, '$.text') = 'text'
    AND trim(json_extract(events.payload_json, '$.text')) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM messages WHERE messages.id = 'event:' || events.id
    )
),
numbered AS (
  SELECT
    candidates.*,
    row_number() OVER (
      PARTITION BY candidates.conversation_id
      ORDER BY candidates.occurred_at ASC, candidates.event_id ASC
    ) AS ordinal
  FROM candidates
  WHERE candidates.conversation_id IS NOT NULL
)
INSERT OR IGNORE INTO messages
  (id, conversation_id, sequence, role, content_json, created_at)
SELECT
  'event:' || numbered.event_id,
  numbered.conversation_id,
  (
    SELECT coalesce(max(messages.sequence), 0)
    FROM messages
    WHERE messages.conversation_id = numbered.conversation_id
  ) + numbered.ordinal,
  'assistant',
  json_object(
    'body', numbered.body,
    'laneId', numbered.lane_id,
    'providerLabel', numbered.runtime_kind,
    'model', numbered.model
  ),
  numbered.occurred_at
FROM numbered;

PRAGMA user_version = 25;
COMMIT;
