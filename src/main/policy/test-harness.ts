import { randomUUID } from "node:crypto";
import { createTestDatabase } from "../db/test-support";
import type { Actor, Capability } from "./action";
import {
  ApprovalRepository,
  type ApprovalResolution,
  type ApprovalRecord,
} from "./approval";
import { PolicyEngine } from "./engine";
import {
  type CapabilityLease,
  type LeaseBudget,
  LeaseRepository,
} from "./lease";

const ACTOR: Actor = { kind: "runtime", runtime: "claude" };
const ISSUED_AT = "2026-07-17T17:00:00Z";
const RESOLVED_AT = "2026-07-17T18:01:00Z";

export function createPolicyHarness() {
  const database = createTestDatabase();
  const leases = new LeaseRepository(database.db);
  const approvals = new ApprovalRepository(database.db);
  const engine = new PolicyEngine({
    leases,
    approvals,
    audit: database.audit,
    createId: randomUUID,
  });

  return {
    ...database,
    leases,
    approvals,
    engine,
    lease(
      capability: Capability,
      resourcePattern: string,
      expiresAt: string,
      overrides: Partial<CapabilityLease> = {},
    ): CapabilityLease {
      const lease: CapabilityLease = {
        id: randomUUID(),
        taskId: database.taskId,
        laneId: database.laneId,
        actor: ACTOR,
        capability,
        resourcePattern,
        budget: { maxUses: null, used: 0 },
        issuedAt: ISSUED_AT,
        expiresAt,
        revokedAt: null,
        ...overrides,
      };
      leases.insert(lease);
      return lease;
    },
    authorizeAt(
      lease: CapabilityLease,
      capability: Capability,
      resource: string,
      now: string,
    ) {
      return engine.authorize({
        leaseId: lease.id,
        actor: ACTOR,
        taskId: database.taskId,
        laneId: database.laneId,
        runId: database.runId,
        capability,
        resource,
        risk: capability === "workspace.read" ? "read" : "prepare",
        now,
      });
    },
    pendingApproval(capability: Capability, resource: string): ApprovalRecord {
      return approvals.create({
        id: randomUUID(),
        runId: database.runId,
        laneId: database.laneId,
        capability,
        resource,
        risk: "execute",
        requestedAt: ISSUED_AT,
        expiresAt: "2026-07-17T19:00:00Z",
      });
    },
    resolve(id: string, resolution: ApprovalResolution): ApprovalRecord {
      return approvals.resolve(id, resolution, RESOLVED_AT);
    },
    auditCount(): number {
      return database.db
        .prepare("SELECT COUNT(*) FROM audit_entries")
        .pluck()
        .get() as number;
    },
    budget(overrides: Partial<LeaseBudget> = {}): LeaseBudget {
      return { maxUses: null, used: 0, ...overrides };
    },
  };
}
