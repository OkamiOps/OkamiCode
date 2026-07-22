import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { GrokProjector } from "./projector";

it("projects Grok streaming-json without inventing tool events", () => {
  const sessionId = randomUUID();
  const projector = new GrokProjector({
    taskId: randomUUID() as TaskId,
    laneId: randomUUID() as LaneId,
    runId: randomUUID() as RunId,
    nativeSessionId: sessionId,
    createEventId: () => randomUUID(),
    now: () => "2026-07-21T12:00:00.000Z",
  });

  expect(projector.sessionEvent().kind).toBe("session_resumed");
  expect(projector.project({ type: "text", data: "Olá" })[0]).toMatchObject({
    kind: "message_delta",
    payload: { runtime: "grok", delta: "Olá" },
  });
  expect(projector.project({ type: "thought", data: "hidden" })).toEqual([]);
  expect(
    projector.project({ type: "end", sessionId }).map((event) => event.kind),
  ).toEqual(["message_completed", "run_completed"]);
});

it("anchors every text delta to one assistant message", () => {
  const projector = new GrokProjector({
    taskId: randomUUID() as TaskId,
    laneId: randomUUID() as LaneId,
    runId: randomUUID() as RunId,
    nativeSessionId: randomUUID(),
    createEventId: () => randomUUID(),
    now: () => "2026-07-21T12:00:00.000Z",
  });

  const first = projector.project({ type: "text", data: "G" })[0];
  const second = projector.project({ type: "text", data: "rok" })[0];

  expect(first?.payload.messageAnchor).toBe("assistant-0");
  expect(second?.payload.messageAnchor).toBe("assistant-0");
});
