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
}
