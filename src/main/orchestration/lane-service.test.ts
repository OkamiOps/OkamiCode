import { describe, expect, it } from "vitest";
import { createLaneHarness } from "./test-harness";

describe("LaneService", () => {
  it("resumes a hot lane without bootstrap", async () => {
    const h = createLaneHarness({
      runtime: "codex",
      nativeSession: "thread-123",
    });
    const opened = await h.openExisting();
    expect(opened.nativeSessionId).toBe("thread-123");
    expect(opened.delta).toBeNull();
    expect(opened.temperature).toBe("hot");
    expect(h.fakeRuntime.resumeCalls).toBe(1);
    expect(h.fakeRuntime.startCalls).toBe(0);
  });

  it("sends only events after the cursor to a stale lane", () => {
    const h = createLaneHarness({
      cursor: 4,
      events: [1, 2, 3, 4, 5, 6, 7],
    });
    const delta = h.buildDelta();
    expect(delta.fromSequenceExclusive).toBe(4);
    expect(delta.events.map((event) => event.sequence)).toEqual([5, 6, 7]);
  });

  it("classifies stale, cold, and clean lanes", async () => {
    const stale = createLaneHarness({
      nativeSession: "session-stale",
      events: [1],
    });
    expect((await stale.openExisting()).temperature).toBe("stale");

    const cold = createLaneHarness();
    const coldOpened = await cold.openExisting();
    expect(coldOpened.temperature).toBe("cold");
    expect(coldOpened.delta).not.toBeNull();
    expect(cold.fakeRuntime.startCalls).toBe(1);

    const clean = createLaneHarness();
    const cleanOpened = await clean.service.open(clean.fx.laneId, {
      inheritTask: false,
    });
    expect(cleanOpened.temperature).toBe("clean");
    expect(cleanOpened.delta).toBeNull();
  });

  it("adds zero bootstrap bytes to a hot lane turn", async () => {
    const h = createLaneHarness({ nativeSession: "session-hot" });
    const opened = await h.openExisting();
    await h.service.sendTurn(opened, "continue");
    expect(h.fakeRuntime.sentTurns[0]?.input).toBe("continue");
  });

  it("builds the exact canonical delta from persisted projections only", () => {
    const h = createLaneHarness({ cursor: 1 });
    const task = h.fx.tasks.findById(h.fx.taskId);
    if (!task) throw new Error("Missing task fixture");
    h.fx.tasks.update(
      {
        ...task,
        objective: "Ship deterministic lanes",
        updatedAt: new Date(Date.parse(task.updatedAt) + 1).toISOString(),
      },
      task.updatedAt,
    );
    h.appendEvent(1, {
      constraints: ["No auxiliary model"],
      decisions: ["Resume native sessions"],
      git: { branch: "feature/lanes", dirtyFiles: ["src/lane.ts"] },
    });
    h.appendEvent(2, { summary: "accepted work" });
    h.addArtifact("file:///tmp/result.txt");

    expect(h.buildDelta()).toEqual({
      schemaVersion: 1,
      taskId: h.fx.taskId,
      fromSequenceExclusive: 1,
      toSequenceInclusive: 2,
      objective: "Ship deterministic lanes",
      constraints: ["No auxiliary model"],
      decisions: ["Resume native sessions"],
      git: { branch: "feature/lanes", dirtyFiles: ["src/lane.ts"] },
      artifacts: ["file:///tmp/result.txt"],
      events: [
        {
          sequence: 2,
          kind: "message_completed",
          summary: "accepted work",
        },
      ],
    });
    expect(h.fakeRuntime.startCalls).toBe(0);
    expect(h.fakeRuntime.resumeCalls).toBe(0);
    expect(h.fakeRuntime.sendTurnCalls).toBe(0);
  });

  it("advances the cursor only after the runtime accepts the delta", async () => {
    const h = createLaneHarness({ events: [1, 2] });
    const opened = await h.openExisting();
    expect(h.fx.lanes.findById(h.fx.laneId)?.lastEventCursor).toBe(0);

    h.fakeRuntime.rejectNextTurn = true;
    await expect(h.service.sendTurn(opened, "continue")).rejects.toThrow(
      "runtime rejected delta",
    );
    expect(h.fx.lanes.findById(h.fx.laneId)?.lastEventCursor).toBe(0);

    await h.service.sendTurn(opened, "continue");
    expect(h.fx.lanes.findById(h.fx.laneId)?.lastEventCursor).toBe(2);
  });

  it("switches lanes with an audit record and leaves the source open", async () => {
    const h = createLaneHarness({ nativeSession: "source-session" });
    const targetLaneId = h.addLane({ nativeSession: "target-session" });
    const sourceBefore = h.fx.lanes.findById(h.fx.laneId);

    const opened = await h.service.switch(h.fx.laneId, targetLaneId);

    expect(opened.nativeSessionId).toBe("target-session");
    expect(h.fx.lanes.findById(h.fx.laneId)?.status).toBe(sourceBefore?.status);
    const audit = h.fx.db
      .prepare(
        `SELECT action, lane_id, metadata_json
         FROM audit_entries WHERE action = 'lane_switched'`,
      )
      .get() as
      { action: string; lane_id: string; metadata_json: string } | undefined;
    expect(audit).toEqual({
      action: "lane_switched",
      lane_id: targetLaneId,
      metadata_json: JSON.stringify({
        sourceLaneId: h.fx.laneId,
        targetLaneId,
      }),
    });
  });
});
