import type { Database } from "../connection";
import { OptimisticConcurrencyError } from "./tasks";

export interface RunRecord {
  id: string;
  taskId: string;
  laneId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  error: unknown | null;
  updatedAt: string;
}

export type NewRunRecord = Omit<RunRecord, "updatedAt">;

interface RunRow {
  id: string;
  task_id: string;
  lane_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_json: string | null;
  updated_at: string;
}

export class RunRepository {
  constructor(private readonly db: Database) {}

  insert(run: NewRunRecord): void {
    this.db
      .prepare(
        `INSERT INTO runs
         (id, task_id, lane_id, status, started_at, finished_at, error_json)
         VALUES (@id, @taskId, @laneId, @status, @startedAt, @finishedAt, @errorJson)`,
      )
      .run({ ...run, errorJson: encodeJson(run.error) });
  }

  findById(id: string): RunRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT runs.*, runtime_lanes.updated_at
         FROM runs
         JOIN runtime_lanes ON runtime_lanes.id = runs.lane_id
         WHERE runs.id = ?`,
      )
      .get(id) as RunRow | undefined;
    return row ? rowToRun(row) : undefined;
  }

  update(run: RunRecord, expectedUpdatedAt: string): void {
    this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE runs
           SET status = @status, finished_at = @finishedAt, error_json = @errorJson
           WHERE id = @id AND task_id = @taskId AND lane_id = @laneId
             AND EXISTS (
               SELECT 1 FROM runtime_lanes
               WHERE runtime_lanes.id = runs.lane_id
                 AND runtime_lanes.updated_at = @expectedUpdatedAt
             )`,
        )
        .run({
          ...run,
          errorJson: encodeJson(run.error),
          expectedUpdatedAt,
        });
      if (result.changes !== 1) {
        throw new OptimisticConcurrencyError("Run", run.id);
      }

      const laneResult = this.db
        .prepare(
          `UPDATE runtime_lanes SET updated_at = @updatedAt
           WHERE id = @laneId AND updated_at = @expectedUpdatedAt`,
        )
        .run({ ...run, expectedUpdatedAt });
      if (laneResult.changes !== 1) {
        throw new OptimisticConcurrencyError("Run", run.id);
      }
    })();
  }

  interruptUnowned(
    liveOwnedRunIds: readonly string[],
    interruptedAt: string,
  ): RunRecord[] {
    const liveIds = [...liveOwnedRunIds];
    const excludedRuns = liveIds.length
      ? ` AND runs.id NOT IN (${liveIds.map(() => "?").join(", ")})`
      : "";
    const rows = this.db
      .prepare(
        `SELECT runs.*, runtime_lanes.updated_at
         FROM runs
         JOIN runtime_lanes ON runtime_lanes.id = runs.lane_id
         WHERE runs.status IN ('starting', 'running', 'waiting_approval')${excludedRuns}`,
      )
      .all(...liveIds) as RunRow[];

    const interrupt = this.db.prepare(
      `UPDATE runs
       SET status = 'interrupted', finished_at = ?
       WHERE id = ? AND status IN ('starting', 'running', 'waiting_approval')`,
    );
    const interrupted: RunRecord[] = [];
    for (const row of rows) {
      if (interrupt.run(interruptedAt, row.id).changes === 1) {
        interrupted.push({
          ...rowToRun(row),
          status: "interrupted",
          finishedAt: interruptedAt,
        });
      }
    }
    return interrupted;
  }
}

function encodeJson(value: unknown | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function rowToRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    laneId: row.lane_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error_json === null ? null : JSON.parse(row.error_json),
    updatedAt: row.updated_at,
  };
}
