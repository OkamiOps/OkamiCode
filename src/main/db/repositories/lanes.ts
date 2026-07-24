import type {
  LaneStatus,
  ProviderKind,
  RuntimeKind,
} from "../../../shared/contracts/lane";
import type { Database } from "../connection";
import {
  decodeTransportSessionBinding,
  isRetiredTransportBinding,
} from "../../runtime/sdk/session-binding";
import { OptimisticConcurrencyError } from "./tasks";

export interface LaneRecord {
  id: string;
  taskId: string;
  runtimeKind: RuntimeKind;
  providerKind: ProviderKind;
  model: string;
  status: LaneStatus;
  workspacePath: string | null;
  permissionMode?: string | null;
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
  migrationFromNativeSessionId?: string;
  rehydrationRequired?: boolean;
}

export interface NativeSessionMigrationRecord {
  laneId: string;
  runtimeKind: RuntimeKind;
  fromNativeSessionId: string;
  toNativeSessionId: string;
  runtimeVersion: string;
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
  permission_mode: string | null;
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
  migration_from_native_session_id: string | null;
  rehydration_required: 0 | 1;
}

export class LaneRepository {
  constructor(private readonly db: Database) {}

  insert(lane: LaneRecord): void {
    this.db
      .prepare(
        `INSERT INTO runtime_lanes
         (id, task_id, runtime_kind, provider_kind, model, status, workspace_path,
          permission_mode, last_event_cursor, created_at, updated_at)
         VALUES (@id, @taskId, @runtimeKind, @providerKind, @model, @status,
                 @workspacePath, @permissionMode, @lastEventCursor, @createdAt,
                 @updatedAt)`,
      )
      .run({ permissionMode: null, ...lane });
  }

  deleteById(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM runtime_lanes WHERE id = ?").run(id)
        .changes === 1
    );
  }

  findById(id: string): LaneRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM runtime_lanes WHERE id = ?")
      .get(id) as LaneRow | undefined;
    return row ? rowToLane(row) : undefined;
  }

  list(taskId?: string): LaneRecord[] {
    const rows = taskId
      ? (this.db
          .prepare(
            `SELECT * FROM runtime_lanes
             WHERE task_id = ?
             ORDER BY updated_at DESC, id ASC`,
          )
          .all(taskId) as LaneRow[])
      : (this.db
          .prepare(
            `SELECT * FROM runtime_lanes
             ORDER BY updated_at DESC, id ASC`,
          )
          .all() as LaneRow[]);
    return rows.map(rowToLane);
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
           updated_at = excluded.updated_at,
           migration_from_native_session_id = NULL,
           rehydration_required = 0`,
      )
      .run(binding);
  }

  bindNativeSessionIfAbsentOrEqual(binding: NativeSessionBindingRecord): void {
    const result = this.db
      .prepare(
        `INSERT INTO native_session_bindings
         (lane_id, native_session_id, runtime_version, bound_at, updated_at)
         VALUES (@laneId, @nativeSessionId, @runtimeVersion, @boundAt, @updatedAt)
         ON CONFLICT(lane_id) DO UPDATE SET
           runtime_version = excluded.runtime_version,
           updated_at = excluded.updated_at
         WHERE native_session_bindings.native_session_id = excluded.native_session_id`,
      )
      .run(binding);
    if (result.changes === 0) {
      throw new Error("Native session binding conflict");
    }
  }

  compareAndMigrateNativeSession(
    migration: NativeSessionMigrationRecord,
  ): void {
    const from = decodeTransportSessionBinding(migration.fromNativeSessionId);
    const to = decodeTransportSessionBinding(migration.toNativeSessionId);
    const sameCurrentTransport =
      from !== undefined &&
      to !== undefined &&
      from.transportId === to.transportId;
    if (
      !sameCurrentTransport &&
      !isRetiredTransportBinding(
        migration.runtimeKind,
        migration.fromNativeSessionId,
      )
    ) {
      throw new Error(
        `Native session migration source is not a retired ${migration.runtimeKind} transport binding`,
      );
    }
    const result = this.db
      .prepare(
        `UPDATE native_session_bindings
         SET native_session_id = @toNativeSessionId,
             runtime_version = @runtimeVersion,
             updated_at = @updatedAt,
             migration_from_native_session_id = @fromNativeSessionId,
             rehydration_required = 1
         WHERE lane_id = @laneId
           AND native_session_id = @fromNativeSessionId`,
      )
      .run(migration);
    if (result.changes !== 1) {
      throw new Error("Native session migration conflict");
    }
  }

  acknowledgeNativeSessionRehydration(
    laneId: string,
    nativeSessionId: string,
    updatedAt: string,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE native_session_bindings
         SET migration_from_native_session_id = NULL,
             rehydration_required = 0,
             updated_at = ?
         WHERE lane_id = ?
           AND native_session_id = ?
           AND rehydration_required = 1`,
      )
      .run(updatedAt, laneId, nativeSessionId);
    if (result.changes !== 1) {
      throw new Error("Native session rehydration acknowledgement conflict");
    }
  }

  markNativeSessionRehydrationRequired(
    laneId: string,
    nativeSessionId: string,
    updatedAt: string,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE native_session_bindings
         SET rehydration_required = 1,
             updated_at = ?
         WHERE lane_id = ?
           AND native_session_id = ?`,
      )
      .run(updatedAt, laneId, nativeSessionId);
    if (result.changes !== 1) {
      throw new Error("Native session rehydration conflict");
    }
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
             permission_mode = @permissionMode,
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
    permissionMode: row.permission_mode,
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
    rehydrationRequired: row.rehydration_required === 1,
    ...(row.migration_from_native_session_id
      ? {
          migrationFromNativeSessionId: row.migration_from_native_session_id,
        }
      : {}),
  };
}
