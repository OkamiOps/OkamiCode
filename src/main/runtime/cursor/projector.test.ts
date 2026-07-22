import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalEventSchema } from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import {
  CursorProjector,
  cursorSessionIdFromInit,
  type CursorProjectionContext,
} from "./projector";

function fixture(name: "fresh" | "process-failure"): unknown[] {
  return readFileSync(`tests/fixtures/runtime/cursor/${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

function testIds(): CursorProjectionContext {
  return {
    taskId: "11111111-1111-4111-8111-111111111111" as TaskId,
    laneId: "22222222-2222-4222-8222-222222222222" as LaneId,
    runId: "33333333-3333-4333-8333-333333333333" as RunId,
    createEventId: (sequence: number) => `cursor-event-${sequence}`,
    now: () => "2026-07-21T12:00:00.000Z",
  };
}

describe("CursorProjector", () => {
  it("projects the official happy-path fixture into valid unique canonical events", () => {
    const native = fixture("fresh");
    const projected = new CursorProjector(testIds()).projectAll(native);

    expect(projected.map((event) => event.kind)).toEqual([
      "session_started",
      "message_delta",
      "tool_call_started",
      "tool_call_completed",
      "message_completed",
      "run_completed",
    ]);
    expect(new Set(projected.map((event) => event.nativeEventId)).size).toBe(
      projected.length,
    );
    expect(() =>
      projected.forEach((event) => canonicalEventSchema.parse(event)),
    ).not.toThrow();
  });

  it("anchors streamed assistant deltas to one message", () => {
    const projector = new CursorProjector(testIds());
    const first = projector.project({
      type: "assistant",
      message: { content: [{ type: "text", text: "Com" }] },
    })[0];
    const second = projector.project({
      type: "assistant",
      message: { content: [{ type: "text", text: "poser" }] },
    })[0];

    expect(first?.payload.messageAnchor).toBe("assistant-0");
    expect(second?.payload.messageAnchor).toBe("assistant-0");
  });

  it("extracts the authoritative init session without inventing a terminal event for process failure", () => {
    const native = fixture("process-failure");
    const projected = new CursorProjector({
      ...testIds(),
      resumed: true,
    }).projectAll(native);

    expect(cursorSessionIdFromInit(native[1])).toBeUndefined();
    expect(cursorSessionIdFromInit(native[0])).toBe(
      "<redacted-resumed-cursor-session-id>",
    );
    expect(projected[0]?.kind).toBe("session_resumed");
    expect(projected.map((event) => event.kind)).not.toContain("run_failed");
    expect(projected.map((event) => event.kind)).not.toContain("run_completed");
  });

  it("correlates tools by call_id and preserves the complete native payload", () => {
    const native = fixture("fresh");
    const projected = new CursorProjector(testIds()).projectAll(native);
    const started = projected.find(
      (event) => event.kind === "tool_call_started",
    );
    const completed = projected.find(
      (event) => event.kind === "tool_call_completed",
    );

    expect(started?.payload.callId).toBe("<redacted-call-id>");
    expect(completed?.payload.callId).toBe(started?.payload.callId);
    expect(started?.payload).toMatchObject({
      toolUseId: "<redacted-call-id>",
      toolName: "Bash",
      input: { command: "git status --short" },
    });
    expect(completed?.payload).toMatchObject({
      toolUseId: "<redacted-call-id>",
      toolName: "Bash",
      input: { command: "git status --short" },
      output: "clean",
    });
    expect(started?.payload.native).toEqual(native[2]);
    expect(completed?.payload.native).toEqual(native[3]);
  });

  it.each([
    ["readToolCall", "Read"],
    ["writeToolCall", "Write"],
    ["shellToolCall", "Bash"],
    ["futureSearchToolCall", "FutureSearch"],
  ])(
    "normalizes %s to merge-compatible tool name %s",
    (nativeName, toolName) => {
      const event = new CursorProjector(testIds()).project({
        type: "tool_call",
        subtype: "started",
        call_id: `call-${nativeName}`,
        tool_call: { [nativeName]: { args: { value: nativeName } } },
      })[0];

      expect(event?.payload).toMatchObject({
        toolUseId: `call-${nativeName}`,
        toolName,
        input: { value: nativeName },
      });
    },
  );

  it("ignores future non-terminal result subtypes and handles success errors defensively", () => {
    const projector = new CursorProjector(testIds());

    expect(
      projector.project({
        type: "result",
        subtype: "progress",
        is_error: false,
        result: "still running",
      }),
    ).toEqual([]);
    expect(
      projector.project({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "defensive failure",
      })[0]?.kind,
    ).toBe("run_failed");
  });

  it("ignores unrelated and unknown event types while retaining unknown fields", () => {
    const native = fixture("fresh");
    const projector = new CursorProjector(testIds());

    expect(projector.project(null)).toEqual([]);
    expect(projector.project({ unrelated: true })).toEqual([]);
    expect(
      projector.project({ type: "future_cursor_event", nested: {} }),
    ).toEqual([]);
    const init = projector.project(native[0])[0];
    expect(
      (init?.payload.native as Record<string, unknown>).future_init_field,
    ).toEqual({ accepted: true });
  });

  it("fails closed for malformed known event shapes", () => {
    const projector = new CursorProjector(testIds());

    expect(() =>
      cursorSessionIdFromInit({ type: "system", subtype: "init" }),
    ).toThrow("Cursor system/init requires a session_id");
    expect(() =>
      projector.project({ type: "assistant", message: { role: "assistant" } }),
    ).toThrow("Cursor assistant event requires message.content");
    expect(() =>
      projector.project({
        type: "tool_call",
        subtype: "started",
        tool_call: {},
      }),
    ).toThrow("Cursor tool_call requires a call_id");
    expect(() =>
      projector.project({
        type: "tool_call",
        subtype: "completed",
        call_id: "call-1",
      }),
    ).toThrow("Cursor tool_call requires a tool_call payload");
    expect(() =>
      projector.project({
        type: "tool_call",
        subtype: "started",
        call_id: "call-empty",
        tool_call: {},
      }),
    ).toThrow("Cursor tool_call requires a structured tool entry");
    expect(() =>
      projector.project({ type: "result", subtype: "success" }),
    ).toThrow("Cursor result requires is_error");
  });
});
