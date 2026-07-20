import type { Database } from "../connection";

export interface AuditEntry {
  id: string;
  taskId: string | null;
  laneId: string | null;
  runId: string | null;
  actor: string;
  action: string;
  decision: string | null;
  capability: string | null;
  resource: unknown | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

interface AuditEntryRow {
  id: string;
  task_id: string | null;
  lane_id: string | null;
  run_id: string | null;
  actor: string;
  action: string;
  decision: string | null;
  capability: string | null;
  resource_json: string | null;
  metadata_json: string;
  occurred_at: string;
}

export class AuditRepository {
  constructor(private readonly db: Database) {}

  record(entry: AuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO audit_entries
         (id, task_id, lane_id, run_id, actor, action, decision, capability,
          resource_json, metadata_json, occurred_at)
         VALUES (@id, @taskId, @laneId, @runId, @actor, @action, @decision,
                 @capability, @resourceJson, @metadataJson, @occurredAt)`,
      )
      .run({
        ...entry,
        resourceJson:
          entry.resource === null ? null : JSON.stringify(entry.resource),
        metadataJson: JSON.stringify(entry.metadata),
      });
  }

  list(): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, task_id, lane_id, run_id, actor, action, decision,
                capability, resource_json, metadata_json, occurred_at
         FROM audit_entries
         ORDER BY occurred_at ASC, id ASC`,
      )
      .all() as AuditEntryRow[];

    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      laneId: row.lane_id,
      runId: row.run_id,
      actor: row.actor,
      action: row.action,
      decision: row.decision,
      capability: row.capability,
      resource:
        row.resource_json === null ? null : JSON.parse(row.resource_json),
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      occurredAt: row.occurred_at,
    }));
  }
}
