-- Lanes created before ensureLane learned to inherit the task folder were
-- left with a NULL workspace, sending runs to the app cwd and tripping the
-- lease scope. Backfill from the owning task.
UPDATE runtime_lanes
SET workspace_path = (
  SELECT tasks.workspace_path FROM tasks WHERE tasks.id = runtime_lanes.task_id
)
WHERE workspace_path IS NULL;

PRAGMA user_version = 3;
