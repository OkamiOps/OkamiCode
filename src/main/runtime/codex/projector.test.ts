import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalEventSchema } from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { CodexProjector, type CodexProjectionContext } from "./projector";

function fixture(name: "approval" | "turn"): unknown[] {
  return readFileSync(`tests/fixtures/runtime/codex/${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

function testIds(): CodexProjectionContext {
  return {
    taskId: "11111111-1111-4111-8111-111111111111" as TaskId,
    laneId: "22222222-2222-4222-8222-222222222222" as LaneId,
    runId: "33333333-3333-4333-8333-333333333333" as RunId,
    createEventId: (sequence) => `codex-event-${sequence}`,
    now: () => "2026-07-18T12:00:00.000Z",
  };
}

describe("CodexProjector", () => {
  it("projects tool and approval notifications without loss", () => {
    const projected = new CodexProjector(testIds()).projectAll(
      fixture("approval"),
    );

    expect(projected.some((event) => event.kind === "tool_call_started")).toBe(
      true,
    );
    expect(projected.some((event) => event.kind === "approval_requested")).toBe(
      true,
    );
    expect(projected.some((event) => event.kind === "approval_resolved")).toBe(
      true,
    );
    expect(
      projected.some((event) => event.kind === "tool_call_completed"),
    ).toBe(true);
    expect(projected.every((event) => event.nativeEventId !== null)).toBe(true);
    expect(() =>
      projected.forEach((event) => canonicalEventSchema.parse(event)),
    ).not.toThrow();
  });

  it("maps thread, turn, message, and completion notifications", () => {
    const projected = new CodexProjector(testIds()).projectAll(fixture("turn"));

    expect(projected.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "session_started",
        "message_delta",
        "message_completed",
        "run_completed",
      ]),
    );
  });

  it("preserves unknown item notifications as adapter-status updates", () => {
    const projected = new CodexProjector(testIds()).projectAll(fixture("turn"));
    const unknown = projected.find(
      (event) => event.payload.adapterStatus === "unknown_native_event",
    );

    expect(unknown).toMatchObject({
      kind: "tool_call_updated",
      payload: {
        nativeMethod: "item/started",
        nativeItemType: "futureNativeWidget",
      },
    });
    expect(unknown?.nativeEventId).toContain("<redacted-unknown-id>");
  });

  it("ignores unrecognized added fields instead of throwing", () => {
    expect(() =>
      new CodexProjector(testIds()).projectAll([
        ...fixture("turn"),
        {
          method: "item/futureNativeWidget/progress",
          params: {
            threadId: "<redacted-thread-id>",
            turnId: "<redacted-turn-id>",
            itemId: "<redacted-unknown-id>",
            futurePayload: { deeply: { nested: true } },
          },
        },
      ]),
    ).not.toThrow();
  });

  it("normalizes the last Codex turn instead of exposing a nested session snapshot", () => {
    const projected = new CodexProjector(testIds()).project({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        tokenUsage: {
          total: {
            totalTokens: 9_999,
            inputTokens: 8_000,
            cachedInputTokens: 1_000,
            cacheWriteInputTokens: 0,
            outputTokens: 999,
            reasoningOutputTokens: 100,
          },
          last: {
            totalTokens: 130,
            inputTokens: 100,
            cachedInputTokens: 40,
            cacheWriteInputTokens: 5,
            outputTokens: 30,
            reasoningOutputTokens: 7,
          },
          modelContextWindow: 200_000,
        },
      },
    });

    expect(projected[0]).toMatchObject({
      kind: "usage_reported",
      payload: {
        usage: {
          aggregation: "snapshot",
          complete: true,
          input_token_semantics: "includes_cache_read",
          input_tokens: 100,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 5,
          output_tokens: 30,
          reasoning_tokens: 7,
          reasoning_token_semantics: "includes_output",
          observed_total_tokens: 130,
          reported_total_tokens: 130,
          scope: "turn",
          source: "provider",
        },
      },
    });
  });
});
