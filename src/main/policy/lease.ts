import type { Database } from "../db/connection";
import type { Actor, Capability } from "./action";

export interface LeaseBudget {
  maxUses: number | null;
  used: number;
}

export interface CapabilityLease {
  id: string;
  taskId: string;
  laneId: string;
  actor: Actor;
  capability: Capability;
  resourcePattern: string;
  budget: LeaseBudget;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

interface LeaseRow {
  id: string;
  task_id: string;
  lane_id: string;
  actor: string;
  capability: Capability;
  resource_pattern: string;
  budget_json: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export class LeaseRepository {
  constructor(private readonly db: Database) {}

  insert(lease: CapabilityLease): void {
    this.db
      .prepare(
        `INSERT INTO capability_leases
         (id, task_id, lane_id, actor, capability, resource_pattern, budget_json,
          issued_at, expires_at, revoked_at)
         VALUES (@id, @taskId, @laneId, @actorJson, @capability,
                 @resourcePattern, @budgetJson, @issuedAt, @expiresAt,
                 @revokedAt)`,
      )
      .run({
        ...lease,
        actorJson: JSON.stringify(lease.actor),
        budgetJson: JSON.stringify(lease.budget),
      });
  }

  findById(id: string): CapabilityLease | undefined {
    const row = this.db
      .prepare("SELECT * FROM capability_leases WHERE id = ?")
      .get(id) as LeaseRow | undefined;
    return row ? rowToLease(row) : undefined;
  }
}

export function actorsMatch(left: Actor, right: Actor): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "runtime" && right.kind === "runtime") {
    return left.runtime === right.runtime;
  }
  if (left.kind !== "runtime" && right.kind !== "runtime") {
    return left.id === right.id;
  }
  return false;
}

export function resourceMatches(pattern: string, resource: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u").test(resource);
}

export function budgetExceeded(
  budget: LeaseBudget,
  requestedUses: number,
): boolean {
  return (
    budget.maxUses !== null && budget.used + requestedUses > budget.maxUses
  );
}

function rowToLease(row: LeaseRow): CapabilityLease {
  return {
    id: row.id,
    taskId: row.task_id,
    laneId: row.lane_id,
    actor: JSON.parse(row.actor) as Actor,
    capability: row.capability,
    resourcePattern: row.resource_pattern,
    budget: JSON.parse(row.budget_json) as LeaseBudget,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}
