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

export interface NativeSessionBindingRecord {
  laneId: string;
  nativeSessionId: string;
  runtimeVersion: string;
  boundAt: string;
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

interface NativeSessionBindingRow {
  lane_id: string;
  native_session_id: string;
  runtime_version: string;
  bound_at: string;
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

  findNativeSessionBinding(
    laneId: string,
  ): NativeSessionBindingRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM native_session_bindings WHERE lane_id = ?")
      .get(laneId) as NativeSessionBindingRow | undefined;
    return row ? rowToNativeSessionBinding(row) : undefined;
  }

  bindNativeSession(binding: NativeSessionBindingRecord): void {
    this.db
      .prepare(
        `INSERT INTO native_session_bindings
         (lane_id, native_session_id, runtime_version, bound_at, updated_at)
         VALUES (@laneId, @nativeSessionId, @runtimeVersion, @boundAt, @updatedAt)
         ON CONFLICT(lane_id) DO UPDATE SET
           native_session_id = excluded.native_session_id,
           runtime_version = excluded.runtime_version,
           updated_at = excluded.updated_at`,
      )
      .run(binding);
  }

  advanceCursor(
    id: string,
    fromSequenceExclusive: number,
    toSequenceInclusive: number,
    updatedAt: string,
  ): void {
    if (toSequenceInclusive < fromSequenceExclusive) {
      throw new Error("A lane cursor cannot move backwards");
    }
    if (toSequenceInclusive === fromSequenceExclusive) return;
    const result = this.db
      .prepare(
        `UPDATE runtime_lanes
         SET last_event_cursor = ?, updated_at = ?
         WHERE id = ? AND last_event_cursor = ?`,
      )
      .run(toSequenceInclusive, updatedAt, id, fromSequenceExclusive);
    if (result.changes !== 1) {
      throw new OptimisticConcurrencyError("Lane cursor", id);
    }
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

function rowToNativeSessionBinding(
  row: NativeSessionBindingRow,
): NativeSessionBindingRecord {
  return {
    laneId: row.lane_id,
    nativeSessionId: row.native_session_id,
    runtimeVersion: row.runtime_version,
    boundAt: row.bound_at,
    updatedAt: row.updated_at,
  };
}
