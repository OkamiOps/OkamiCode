import type { Database } from "../db/connection";
import type { Capability, RiskLevel } from "./action";

export type ApprovalStatus = "pending" | "allowed_once" | "denied" | "expired";
export type ApprovalResolution =
  "allow_once" | "allowed_once" | "deny" | "denied" | "expire" | "expired";

export interface ApprovalRecord {
  id: string;
  runId: string;
  laneId: string;
  capability: Capability;
  resource: unknown;
  risk: RiskLevel;
  status: ApprovalStatus;
  resolution: Exclude<ApprovalStatus, "pending"> | null;
  requestedAt: string;
  resolvedAt: string | null;
  expiresAt: string;
}

export type PendingApproval = Omit<
  ApprovalRecord,
  "status" | "resolution" | "resolvedAt"
>;

interface ApprovalRow {
  id: string;
  run_id: string;
  lane_id: string;
  capability: Capability;
  resource_json: string;
  risk: RiskLevel;
  status: ApprovalStatus;
  resolution: Exclude<ApprovalStatus, "pending"> | null;
  requested_at: string;
  resolved_at: string | null;
  expires_at: string;
}

export class ApprovalRepository {
  constructor(private readonly db: Database) {}

  create(approval: PendingApproval): ApprovalRecord {
    this.db
      .prepare(
        `INSERT INTO approvals
         (id, run_id, lane_id, capability, resource_json, risk, status,
          resolution, requested_at, resolved_at, expires_at)
         VALUES (@id, @runId, @laneId, @capability, @resourceJson, @risk,
                 'pending', NULL, @requestedAt, NULL, @expiresAt)`,
      )
      .run({ ...approval, resourceJson: JSON.stringify(approval.resource) });
    return {
      ...approval,
      status: "pending",
      resolution: null,
      resolvedAt: null,
    };
  }

  findById(id: string): ApprovalRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM approvals WHERE id = ?")
      .get(id) as ApprovalRow | undefined;
    return row ? rowToApproval(row) : undefined;
  }

  resolve(
    id: string,
    resolution: ApprovalResolution,
    resolvedAt: string,
  ): ApprovalRecord {
    const status = normalizeResolution(resolution);
    const result = this.db
      .prepare(
        `UPDATE approvals
         SET status = @status, resolution = @status, resolved_at = @resolvedAt
         WHERE id = @id AND status = 'pending'`,
      )
      .run({ id, status, resolvedAt });

    if (result.changes !== 1) {
      if (this.findById(id)) throw new Error("already resolved");
      throw new Error(`approval ${id} not found`);
    }

    return this.findById(id) as ApprovalRecord;
  }

  expirePendingForRuns(runIds: readonly string[], resolvedAt: string): number {
    if (runIds.length === 0) return 0;
    const result = this.db
      .prepare(
        `UPDATE approvals
         SET status = 'expired', resolution = 'expired', resolved_at = ?
         WHERE status = 'pending'
           AND run_id IN (${runIds.map(() => "?").join(", ")})`,
      )
      .run(resolvedAt, ...runIds);
    return result.changes;
  }
}

function normalizeResolution(
  resolution: ApprovalResolution,
): Exclude<ApprovalStatus, "pending"> {
  if (resolution === "allow_once" || resolution === "allowed_once") {
    return "allowed_once";
  }
  if (resolution === "deny" || resolution === "denied") return "denied";
  return "expired";
}

function rowToApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    laneId: row.lane_id,
    capability: row.capability,
    resource: JSON.parse(row.resource_json),
    risk: row.risk,
    status: row.status,
    resolution: row.resolution,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    expiresAt: row.expires_at,
  };
}
