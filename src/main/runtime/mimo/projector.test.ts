import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { MimoProjector } from "./projector";

describe("MimoProjector", () => {
  it("projects OpenCode JSON events into one assistant stream", () => {
    const projector = new MimoProjector({
      taskId: randomUUID() as TaskId,
      laneId: randomUUID() as LaneId,
      runId: randomUUID() as RunId,
      createEventId: () => randomUUID(),
      now: () => "2026-07-22T00:00:00.000Z",
    });
    const first = projector.project({
      type: "text",
      sessionID: "ses_123",
      part: { type: "text", text: "Mi" },
    });
    const second = projector.project({
      type: "text",
      sessionID: "ses_123",
      part: { type: "text", text: "Mo" },
    });

    expect(first.map((event) => event.kind)).toEqual([
      "session_started",
      "message_delta",
    ]);
    expect(first[1]?.payload).toMatchObject({
      runtime: "mimo",
      delta: "Mi",
      messageAnchor: "assistant-0",
    });
    expect(second[0]?.payload).toMatchObject({
      delta: "Mo",
      messageAnchor: "assistant-0",
    });
    expect(projector.nativeSessionId).toBe("ses_123");
  });

  it("rejects a stream that changes session identity", () => {
    const projector = new MimoProjector({
      taskId: randomUUID() as TaskId,
      laneId: randomUUID() as LaneId,
      runId: randomUUID() as RunId,
      createEventId: () => randomUUID(),
    });
    projector.project({ type: "text", sessionID: "ses_one", text: "a" });
    expect(() =>
      projector.project({ type: "text", sessionID: "ses_two", text: "b" }),
    ).toThrow("MiMo session changed during the run");
  });
});
