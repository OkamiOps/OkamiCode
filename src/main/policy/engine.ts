import { randomUUID } from "node:crypto";
import type { AuditRepository } from "../db/repositories/audit";
import type {
  Actor,
  AuthorizationDecision,
  Capability,
  RiskLevel,
} from "./action";
import type { ApprovalRepository } from "./approval";
import {
  actorsMatch,
  budgetExceeded,
  type LeaseRepository,
  resourceMatches,
} from "./lease";

export interface AuthorizationRequest {
  leaseId?: string | null;
  actor: Actor;
  taskId: string;
  laneId: string;
  runId: string;
  capability: Capability;
  resource: string;
  risk: RiskLevel;
  destructive?: boolean;
  outsideWorkspace?: boolean;
  budgetCost?: number;
  now: string;
}

export interface PolicyEngineDependencies {
  leases: LeaseRepository;
  approvals: ApprovalRepository;
  audit: AuditRepository;
  createId?: () => string;
}

export class PolicyEngine {
  private readonly createId: () => string;

  constructor(private readonly dependencies: PolicyEngineDependencies) {
    this.createId = dependencies.createId ?? randomUUID;
  }

  authorize(request: AuthorizationRequest): AuthorizationDecision {
    if (request.destructive === true && request.outsideWorkspace === true) {
      return this.finish(request, {
        decision: "deny",
        reason: "destructive_outside_workspace",
      });
    }

    if (!request.leaseId) {
      return this.finish(request, {
        decision: "deny",
        reason: "missing_lease",
      });
    }

    const lease = this.dependencies.leases.findById(request.leaseId);
    if (!lease) {
      return this.finish(request, {
        decision: "deny",
        reason: "missing_lease",
      });
    }

    if (
      lease.revokedAt !== null ||
      Date.parse(request.now) >= Date.parse(lease.expiresAt)
    ) {
      return this.finish(request, { decision: "deny", reason: "expired" });
    }

    if (!actorsMatch(lease.actor, request.actor)) {
      return this.finish(request, {
        decision: "deny",
        reason: "actor_mismatch",
      });
    }

    if (lease.taskId !== request.taskId) {
      return this.finish(request, {
        decision: "deny",
        reason: "task_mismatch",
      });
    }

    if (lease.laneId !== request.laneId) {
      return this.finish(request, {
        decision: "deny",
        reason: "lane_mismatch",
      });
    }

    if (lease.capability !== request.capability) {
      return this.finish(request, {
        decision: "deny",
        reason: "capability_mismatch",
      });
    }

    if (!resourceMatches(lease.resourcePattern, request.resource)) {
      return this.finish(request, {
        decision: "deny",
        reason: "resource_mismatch",
      });
    }

    if (budgetExceeded(lease.budget, request.budgetCost ?? 1)) {
      return this.finish(request, {
        decision: "deny",
        reason: "budget_exceeded",
      });
    }

    if (request.risk === "execute" || request.risk === "critical") {
      const approvalId = this.createId();
      this.dependencies.approvals.create({
        id: approvalId,
        runId: request.runId,
        laneId: request.laneId,
        capability: request.capability,
        resource: request.resource,
        risk: request.risk,
        requestedAt: request.now,
        expiresAt: lease.expiresAt,
      });
      return this.finish(request, { decision: "ask", approvalId });
    }

    return this.finish(request, {
      decision: "allow",
      leaseId: lease.id,
    });
  }

  private finish(
    request: AuthorizationRequest,
    decision: AuthorizationDecision,
  ): AuthorizationDecision {
    this.dependencies.audit.record({
      id: this.createId(),
      taskId: request.taskId,
      laneId: request.laneId,
      runId: request.runId,
      actor: JSON.stringify(request.actor),
      action: "authorize",
      decision: decision.decision,
      capability: request.capability,
      resource: request.resource,
      metadata:
        decision.decision === "deny"
          ? { reason: decision.reason }
          : decision.decision === "ask"
            ? { approvalId: decision.approvalId, risk: request.risk }
            : { leaseId: decision.leaseId, risk: request.risk },
      occurredAt: request.now,
    });
    return decision;
  }
}
