-- Runs never had their terminal status written back, so every historical row
-- still claims to be running. Close them at their last recorded event.
UPDATE runs
SET status = 'completed',
    finished_at = COALESCE(
      (SELECT MAX(events.occurred_at) FROM events WHERE events.run_id = runs.id),
      runs.started_at
    )
WHERE finished_at IS NULL;

PRAGMA user_version = 5;
