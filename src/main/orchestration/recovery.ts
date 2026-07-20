import type { Database } from "../db/connection";
import type { AuditRepository } from "../db/repositories/audit";
import type { RunRepository } from "../db/repositories/runs";
import type { ApprovalRepository } from "../policy/approval";

export interface RecoveryReport {
  interruptedRuns: number;
  expiredApprovals: number;
}

interface StartupRecoveryDependencies {
  db: Database;
  runs: Pick<RunRepository, "interruptUnowned">;
  approvals: Pick<ApprovalRepository, "expirePendingForRuns">;
  audit: Pick<AuditRepository, "record">;
  supervisor: { liveOwnedRunIds(): readonly string[] };
  createId: () => string;
  clock?: () => Date;
}

export class StartupRecovery {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: StartupRecoveryDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  reconcileStartup(): RecoveryReport {
    const now = this.clock().toISOString();
    const liveOwnedRunIds = this.dependencies.supervisor.liveOwnedRunIds();

    return this.dependencies.db.transaction(() => {
      const interrupted = this.dependencies.runs.interruptUnowned(
        liveOwnedRunIds,
        now,
      );
      const expiredApprovals = this.dependencies.approvals.expirePendingForRuns(
        interrupted.map((run) => run.id),
        now,
      );

      for (const run of interrupted) {
        this.dependencies.audit.record({
          id: this.dependencies.createId(),
          taskId: run.taskId,
          laneId: run.laneId,
          runId: run.id,
          actor: "system",
          action: "run_interrupted",
          decision: null,
          capability: null,
          resource: null,
          metadata: { reason: "restart_recovery" },
          occurredAt: now,
        });
      }

      return {
        interruptedRuns: interrupted.length,
        expiredApprovals,
      };
    })();
  }
}
