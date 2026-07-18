import type { LaneStatus, RuntimeKind } from "../../../shared/contracts/lane";
import type { Database } from "../connection";
import { OptimisticConcurrencyError } from "./tasks";

export interface LaneRecord {
  id: string;
  taskId: string;
  runtimeKind: RuntimeKind;
  providerKind: "claude_max" | "chatgpt";
  model: string;
  status: LaneStatus;
  workspacePath: string | null;
  lastEventCursor: number;
  createdAt: string;
  updatedAt: string;
}

interface LaneRow {
  id: string;
  task_id: string;
  runtime_kind: RuntimeKind;
  provider_kind: LaneRecord["providerKind"];
  model: string;
  status: LaneStatus;
  workspace_path: string | null;
  last_event_cursor: number;
  created_at: string;
  updated_at: string;
}

export class LaneRepository {
  constructor(private readonly db: Database) {}

  insert(lane: LaneRecord): void {
    this.db
      .prepare(
        `INSERT INTO runtime_lanes
         (id, task_id, runtime_kind, provider_kind, model, status, workspace_path,
          last_event_cursor, created_at, updated_at)
         VALUES (@id, @taskId, @runtimeKind, @providerKind, @model, @status,
                 @workspacePath, @lastEventCursor, @createdAt, @updatedAt)`,
      )
      .run(lane);
  }

  findById(id: string): LaneRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM runtime_lanes WHERE id = ?")
      .get(id) as LaneRow | undefined;
    return row ? rowToLane(row) : undefined;
  }

  update(lane: LaneRecord, expectedUpdatedAt: string): void {
    const result = this.db
      .prepare(
        `UPDATE runtime_lanes
         SET runtime_kind = @runtimeKind, provider_kind = @providerKind,
             model = @model, status = @status, workspace_path = @workspacePath,
             last_event_cursor = @lastEventCursor, updated_at = @updatedAt
         WHERE id = @id AND updated_at = @expectedUpdatedAt`,
      )
      .run({ ...lane, expectedUpdatedAt });
    if (result.changes !== 1) {
      throw new OptimisticConcurrencyError("Lane", lane.id);
    }
  }
}

function rowToLane(row: LaneRow): LaneRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    runtimeKind: row.runtime_kind,
    providerKind: row.provider_kind,
    model: row.model,
    status: row.status,
    workspacePath: row.workspace_path,
    lastEventCursor: row.last_event_cursor,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
