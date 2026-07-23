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

  it("normalizes MiMo step-finish token accounting", () => {
    const projector = new MimoProjector({
      taskId: randomUUID() as TaskId,
      laneId: randomUUID() as LaneId,
      runId: randomUUID() as RunId,
      createEventId: () => randomUUID(),
    });

    const events = projector.project({
      type: "step_finish",
      sessionID: "ses_usage",
      part: {
        type: "step-finish",
        tokens: {
          input: 500,
          output: 50,
          reasoning: 10,
          cache: { read: 100, write: 0 },
        },
      },
    });

    expect(events.at(-1)).toMatchObject({
      kind: "usage_reported",
      payload: {
        runtime: "mimo",
        usage: {
          aggregation: "delta",
          complete: true,
          input_token_semantics: "excludes_cache_read",
          input_tokens: 500,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
          output_tokens: 50,
          reasoning_tokens: 10,
          reasoning_token_semantics: "excludes_output",
          observed_total_tokens: 660,
          scope: "model_call",
          source: "provider",
        },
      },
    });
  });
});
