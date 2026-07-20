import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApprovalRepository } from "../policy/approval";
import { StartupRecovery } from "./recovery";
import { createTestDatabase } from "../db/test-support";

describe("StartupRecovery", () => {
  it("interrupts only orphaned active runs, expires their approvals, and is idempotent", () => {
    const fx = createTestDatabase();
    const approvals = new ApprovalRepository(fx.db);
    const timestamp = "2026-07-21T12:00:00.000Z";
    const waitingApprovalRunId = randomUUID();
    const liveRunId = randomUUID();

    fx.db
      .prepare(
        `INSERT INTO runs
         (id, task_id, lane_id, status, started_at, finished_at, error_json)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(
        waitingApprovalRunId,
        fx.taskId,
        fx.laneId,
        "waiting_approval",
        timestamp,
      );
    fx.db
      .prepare(
        `INSERT INTO runs
         (id, task_id, lane_id, status, started_at, finished_at, error_json)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(liveRunId, fx.taskId, fx.laneId, "starting", timestamp);
    const orphanApproval = approvals.create({
      id: randomUUID(),
      runId: waitingApprovalRunId,
      laneId: fx.laneId,
      capability: "terminal.exec",
      resource: "git status",
      risk: "execute",
      requestedAt: timestamp,
      expiresAt: "2026-07-21T13:00:00.000Z",
    });
    const liveApproval = approvals.create({
      id: randomUUID(),
      runId: liveRunId,
      laneId: fx.laneId,
      capability: "terminal.exec",
      resource: "git status",
      risk: "execute",
      requestedAt: timestamp,
      expiresAt: "2026-07-21T13:00:00.000Z",
    });
    fx.db
      .prepare("UPDATE runtime_lanes SET last_event_cursor = 9 WHERE id = ?")
      .run(fx.laneId);

    const recovery = new StartupRecovery({
      db: fx.db,
      runs: fx.runs,
      approvals,
      audit: fx.audit,
      supervisor: { liveOwnedRunIds: () => [liveRunId] },
      createId: (() => {
        let next = 0;
        return () => `audit-${++next}`;
      })(),
      clock: () => new Date(timestamp),
    });

    expect(recovery.reconcileStartup()).toEqual({
      interruptedRuns: 2,
      expiredApprovals: 1,
    });
    expect(fx.runs.findById(fx.runId)).toMatchObject({
      status: "interrupted",
      finishedAt: timestamp,
    });
    expect(fx.runs.findById(waitingApprovalRunId)).toMatchObject({
      status: "interrupted",
      finishedAt: timestamp,
    });
    expect(fx.runs.findById(liveRunId)).toMatchObject({ status: "starting" });
    expect(approvals.findById(orphanApproval.id)).toMatchObject({
      status: "expired",
      resolution: "expired",
      resolvedAt: timestamp,
    });
    expect(approvals.findById(liveApproval.id)).toMatchObject({
      status: "pending",
    });
    expect(
      fx.db
        .prepare("SELECT last_event_cursor FROM runtime_lanes WHERE id = ?")
        .pluck()
        .get(fx.laneId),
    ).toBe(9);
    expect(
      fx.db
        .prepare(
          "SELECT run_id FROM audit_entries WHERE action = 'run_interrupted' ORDER BY run_id",
        )
        .pluck()
        .all(),
    ).toEqual([fx.runId, waitingApprovalRunId].sort());

    expect(recovery.reconcileStartup()).toEqual({
      interruptedRuns: 0,
      expiredApprovals: 0,
    });
    expect(
      fx.db
        .prepare(
          "SELECT COUNT(*) FROM audit_entries WHERE action = 'run_interrupted'",
        )
        .pluck()
        .get(),
    ).toBe(2);
  });
});
