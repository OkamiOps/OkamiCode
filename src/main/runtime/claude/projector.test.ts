import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalEventSchema } from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import {
  ClaudeProjector,
  claudeSessionIdFromInit,
  type ClaudeProjectionContext,
} from "./projector";

const fixture = readFileSync(
  "tests/fixtures/runtime/claude/session.jsonl",
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as unknown);

function testIds(): ClaudeProjectionContext {
  return {
    taskId: "11111111-1111-4111-8111-111111111111" as TaskId,
    laneId: "22222222-2222-4222-8222-222222222222" as LaneId,
    runId: "33333333-3333-4333-8333-333333333333" as RunId,
    createEventId: (sequence) => `claude-event-${sequence}`,
    now: () => "2026-07-18T12:00:00.000Z",
  };
}

describe("ClaudeProjector", () => {
  it("uses system/init as the authoritative native session binding", () => {
    expect(claudeSessionIdFromInit(fixture[0])).toBeUndefined();
    expect(claudeSessionIdFromInit(fixture[1])).toBe("<redacted-session-id>");
    expect(
      new ClaudeProjector({ ...testIds(), resumed: true }).project(
        fixture[1],
      )[0]?.kind,
    ).toBe("session_resumed");
  });

  it("projects messages, tools, hooks, usage, and the terminal result", () => {
    const projected = new ClaudeProjector(testIds()).projectAll(fixture);

    expect(projected.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "session_started",
        "message_delta",
        "message_completed",
        "tool_call_started",
        "tool_call_updated",
        "tool_call_completed",
        "usage_reported",
        "run_completed",
      ]),
    );
    expect(projected.every((event) => event.nativeEventId !== null)).toBe(true);
    expect(() =>
      projected.forEach((event) => canonicalEventSchema.parse(event)),
    ).not.toThrow();
  });

  it("accepts unrecognized added native fields without throwing", () => {
    expect(() =>
      new ClaudeProjector(testIds()).projectAll(fixture),
    ).not.toThrow();
  });

  it("keeps cache creation and reported cost in canonical turn usage", () => {
    const projected = new ClaudeProjector(testIds()).project({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "OK",
      total_cost_usd: 0.0042,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 25,
        cache_read_input_tokens: 40,
        output_tokens: 5,
      },
    });

    expect(
      projected.find((event) => event.kind === "usage_reported"),
    ).toMatchObject({
      payload: {
        usage: {
          aggregation: "snapshot",
          complete: true,
          input_token_semantics: "excludes_cache_read",
          input_tokens: 10,
          cache_creation_input_tokens: 25,
          cache_read_input_tokens: 40,
          output_tokens: 5,
          observed_total_tokens: 80,
          scope: "turn",
          source: "provider",
          cost_usd: 0.0042,
        },
      },
    });
  });
});
