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

it("projects Grok end usage before the terminal event", () => {
  const projector = new GrokProjector({
    taskId: randomUUID() as TaskId,
    laneId: randomUUID() as LaneId,
    runId: randomUUID() as RunId,
    nativeSessionId: "grok-session",
    createEventId: () => randomUUID(),
  });

  const events = projector.project({
    type: "end",
    sessionId: "grok-session",
    usage: {
      inputTokens: 300,
      cachedReadTokens: 40,
      outputTokens: 30,
      reasoningTokens: 10,
      totalTokens: 330,
      costUsd: 0.003,
    },
  });

  expect(events.map((event) => event.kind)).toEqual([
    "usage_reported",
    "run_completed",
  ]);
  expect(events[0]?.payload.usage).toEqual({
    aggregation: "snapshot",
    complete: true,
    input_token_semantics: "includes_cache_read",
    input_tokens: 300,
    cache_read_input_tokens: 40,
    output_tokens: 30,
    reasoning_tokens: 10,
    reasoning_token_semantics: "includes_output",
    observed_total_tokens: 330,
    reported_total_tokens: 330,
    scope: "turn",
    source: "provider",
    cost_usd: 0.003,
  });
});
