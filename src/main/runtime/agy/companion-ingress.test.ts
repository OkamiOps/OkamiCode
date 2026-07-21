import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import {
  AgyCompanionIngress,
  type AgyCompanionIngressContext,
} from "./companion-ingress";

function fixture(
  name: "pre-invocation" | "pre-tool-use" | "post-tool-use" | "stop",
): unknown {
  return JSON.parse(
    readFileSync(`tests/fixtures/runtime/agy/${name}.json`, "utf8"),
  ) as unknown;
}

function context(): AgyCompanionIngressContext {
  return {
    taskId: "11111111-1111-4111-8111-111111111111" as TaskId,
    laneId: "22222222-2222-4222-8222-222222222222" as LaneId,
    runId: "33333333-3333-4333-8333-333333333333" as RunId,
    createEventId: (sequence) => `agy-ingress-${sequence}`,
    now: () => "2026-07-21T12:00:00.000Z",
  };
}

describe("AgyCompanionIngress", () => {
  it("projects an official hook envelope and associates its first conversation", () => {
    const ingress = new AgyCompanionIngress(context());

    expect(
      ingress.receive({
        hookName: "PreToolUse",
        payload: fixture("pre-tool-use"),
      }),
    ).toMatchObject([
      {
        kind: "session_started",
        payload: { nativeSessionId: "<redacted-agy-conversation-id>" },
      },
      { kind: "tool_call_started" },
    ]);
    expect(ingress.conversationId).toBe("<redacted-agy-conversation-id>");
  });

  it("deduplicates a replay before it reaches the projector", () => {
    const ingress = new AgyCompanionIngress(context());
    const envelope = {
      hookName: "PreToolUse" as const,
      payload: fixture("pre-tool-use"),
    };

    expect(ingress.receive(envelope)).toHaveLength(2);
    expect(ingress.receive(envelope)).toEqual([]);
  });

  it("keeps different payloads for a stable hook identity observable", () => {
    const ingress = new AgyCompanionIngress(context());
    const original = fixture("post-tool-use") as Record<string, unknown>;

    ingress.receive({
      hookName: "PreToolUse",
      payload: fixture("pre-tool-use"),
    });
    expect(
      ingress.receive({
        hookName: "PostToolUse",
        payload: { ...original, error: "temporary failure" },
      }),
    ).toMatchObject([
      { kind: "tool_call_completed", payload: { isError: true } },
    ]);
    expect(
      ingress.receive({ hookName: "PostToolUse", payload: original }),
    ).toMatchObject([
      { kind: "tool_call_completed", payload: { isError: false } },
    ]);
  });

  it("holds an idle Stop until stdout has been projected and deduplicates its replay", () => {
    const ingress = new AgyCompanionIngress(context());
    const envelope = { hookName: "Stop" as const, payload: fixture("stop") };

    expect(ingress.receive(envelope).map((event) => event.kind)).toEqual([
      "session_started",
    ]);
    expect(
      ingress.completeStdout("Final answer").map((event) => event.kind),
    ).toEqual(["message_completed", "run_completed"]);
    expect(ingress.receive(envelope)).toEqual([]);
  });

  it("allows a non-idle Stop to become terminal for the same execution", () => {
    const ingress = new AgyCompanionIngress(context());
    const stop = fixture("stop") as Record<string, unknown>;

    expect(
      ingress
        .receive({
          hookName: "Stop",
          payload: { ...stop, fullyIdle: false },
        })
        .map((event) => event.kind),
    ).toEqual(["session_started"]);
    expect(
      ingress
        .receive({
          hookName: "Stop",
          payload: { ...stop, fullyIdle: true },
        })
        .map((event) => event.kind),
    ).toEqual([]);
    expect(ingress.completeStdout("").map((event) => event.kind)).toEqual([
      "run_completed",
    ]);
  });

  it("fails closed when a later envelope switches conversations", () => {
    const ingress = new AgyCompanionIngress(context());
    ingress.receive({
      hookName: "PreInvocation",
      payload: fixture("pre-invocation"),
    });

    expect(() =>
      ingress.receive({
        hookName: "PostToolUse",
        payload: {
          ...(fixture("post-tool-use") as Record<string, unknown>),
          conversationId: "different-conversation",
        },
      }),
    ).toThrow("AGY companion conversationId changed during the run");
  });
});
