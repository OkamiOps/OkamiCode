import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalEventSchema } from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import {
  AgyHookProjector,
  parseAgyHook,
  parseAgyTranscriptLine,
  type AgyHookProjectionContext,
} from "./hook-contract";

type HookName = "PostToolUse" | "PreInvocation" | "PreToolUse" | "Stop";

function hook(name: HookName): unknown {
  const fileName = name.replace(/([a-z])([A-Z])/gu, "$1-$2").toLowerCase();
  return JSON.parse(
    readFileSync(`tests/fixtures/runtime/agy/${fileName}.json`, "utf8"),
  ) as unknown;
}

function transcript(): unknown[] {
  return readFileSync("tests/fixtures/runtime/agy/transcript.jsonl", "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

function testIds(): AgyHookProjectionContext {
  return {
    taskId: "11111111-1111-4111-8111-111111111111" as TaskId,
    laneId: "22222222-2222-4222-8222-222222222222" as LaneId,
    runId: "33333333-3333-4333-8333-333333333333" as RunId,
    createEventId: (sequence: number) => `agy-event-${sequence}`,
    now: () => "2026-07-21T12:00:00.000Z",
  };
}

describe("AGY hook contract", () => {
  it("strictly parses every official hook fixture while preserving additions", () => {
    for (const name of [
      "PreInvocation",
      "PreToolUse",
      "PostToolUse",
      "Stop",
    ] as const) {
      const native = hook(name);
      const parsed = parseAgyHook(name, native);
      expect(parsed?.native).toEqual(native);
    }
    expect(
      parseAgyHook("PreInvocation", hook("PreInvocation"))?.native.futureCount,
    ).toBe("opaque-future-value");
    expect(parseAgyHook("FutureHook", hook("PreInvocation"))).toBeUndefined();
  });

  it("projects one fresh session plus correlated renderer-compatible tool lifecycle", () => {
    const projector = new AgyHookProjector(testIds());
    const native = [
      hook("PreInvocation"),
      hook("PreToolUse"),
      hook("PostToolUse"),
      hook("Stop"),
    ];
    const events = [
      ...projector.project("PreInvocation", native[0]),
      ...projector.project("PreToolUse", native[1]),
      ...projector.project("PostToolUse", native[2]),
      ...projector.project("Stop", native[3]),
      ...projector.completeStdout("Final answer"),
    ];

    expect(events.map((event) => event.kind)).toEqual([
      "session_started",
      "tool_call_started",
      "tool_call_completed",
      "message_completed",
      "run_completed",
    ]);
    expect(
      events.filter((event) => event.kind.startsWith("session_")),
    ).toHaveLength(1);
    const started = events.find((event) => event.kind === "tool_call_started");
    const completed = events.find(
      (event) => event.kind === "tool_call_completed",
    );
    expect(started?.payload).toMatchObject({
      toolUseId: "<redacted-agy-conversation-id>:1",
      toolName: "Bash",
      input: {
        CommandLine: "git status --short",
        Cwd: "/redacted/workspace",
        WaitMsBeforeAsync: 1000,
        command: "git status --short",
        cwd: "/redacted/workspace",
      },
    });
    expect(completed?.payload).toMatchObject({
      toolUseId: started?.payload.toolUseId,
      toolName: "Bash",
      input: {
        CommandLine: "git status --short",
        Cwd: "/redacted/workspace",
        WaitMsBeforeAsync: 1000,
        command: "git status --short",
        cwd: "/redacted/workspace",
      },
      isError: false,
    });
    expect(completed?.payload.native).toEqual(native[2]);
    expect(new Set(events.map((event) => event.nativeEventId)).size).toBe(
      events.length,
    );
    expect(() =>
      events.forEach((event) => canonicalEventSchema.parse(event)),
    ).not.toThrow();
  });

  it("resumes from the first valid hook and never emits a second session event", () => {
    const projector = new AgyHookProjector({ ...testIds(), resumed: true });
    const events = [
      ...projector.project("PreToolUse", hook("PreToolUse")),
      ...projector.project("PostToolUse", hook("PostToolUse")),
    ];

    expect(events.map((event) => event.kind)).toEqual([
      "session_resumed",
      "tool_call_started",
      "tool_call_completed",
    ]);
  });

  it("emits an honestly sparse correlatable completion when PostToolUse arrives without PreToolUse", () => {
    const events = new AgyHookProjector(testIds()).project(
      "PostToolUse",
      hook("PostToolUse"),
    );
    const completed = events.at(-1);

    expect(completed).toMatchObject({
      kind: "tool_call_completed",
      payload: {
        toolUseId: "<redacted-agy-conversation-id>:1",
        isError: false,
      },
    });
    expect(completed?.payload).not.toHaveProperty("toolName");
    expect(completed?.payload).not.toHaveProperty("input");
  });

  it.each([
    ["run_command", "Bash"],
    ["view_file", "Read"],
    ["write_to_file", "Write"],
    ["replace_file_content", "Edit"],
    ["multi_replace_file_content", "Edit"],
    ["grep_search", "Grep"],
    ["find_by_name", "Glob"],
    ["search_web", "WebSearch"],
    ["read_url_content", "WebFetch"],
    ["future_custom_tool", "Future Custom Tool"],
  ])("normalizes AGY tool %s as %s", (toolName, expected) => {
    const native = {
      ...(hook("PreToolUse") as Record<string, unknown>),
      toolCall: { name: toolName, args: { value: toolName } },
    };
    const events = new AgyHookProjector(testIds()).project(
      "PreToolUse",
      native,
    );

    expect(events.at(-1)?.payload.toolName).toBe(expected);
  });

  it.each([
    {
      toolName: "run_command",
      args: {
        CommandLine: "pwd",
        Cwd: "/redacted/workspace",
        WaitMsBeforeAsync: 500,
      },
      aliases: { command: "pwd", cwd: "/redacted/workspace" },
    },
    {
      toolName: "view_file",
      args: { AbsolutePath: "/redacted/workspace/a.ts", EndLine: 20 },
      aliases: { file_path: "/redacted/workspace/a.ts" },
    },
    {
      toolName: "write_to_file",
      args: {
        TargetFile: "/redacted/workspace/a.ts",
        CodeContent: "new content",
      },
      aliases: {
        file_path: "/redacted/workspace/a.ts",
        content: "new content",
      },
    },
    {
      toolName: "replace_file_content",
      args: {
        TargetFile: "/redacted/workspace/a.ts",
        TargetContent: "before",
        ReplacementContent: "after",
      },
      aliases: {
        file_path: "/redacted/workspace/a.ts",
        old_string: "before",
        new_string: "after",
      },
    },
    {
      toolName: "multi_replace_file_content",
      args: {
        TargetFile: "/redacted/workspace/a.ts",
        ReplacementChunks: [
          { TargetContent: "before", ReplacementContent: "after" },
        ],
      },
      aliases: {
        file_path: "/redacted/workspace/a.ts",
      },
    },
    {
      toolName: "read_url_content",
      args: { Url: "https://example.invalid/docs", TimeoutMs: 1000 },
      aliases: { url: "https://example.invalid/docs" },
    },
  ])(
    "preserves official $toolName args and derives renderer aliases",
    ({ toolName, args, aliases }) => {
      const native = {
        ...(hook("PreToolUse") as Record<string, unknown>),
        toolCall: { name: toolName, args },
      };
      const event = new AgyHookProjector(testIds())
        .project("PreToolUse", native)
        .at(-1);

      expect(event?.payload.input).toMatchObject({ ...args, ...aliases });
      expect(event?.payload.native).toEqual(native);
    },
  );

  it("fails closed when a later hook changes conversationId", () => {
    const projector = new AgyHookProjector(testIds());
    projector.project("PreToolUse", hook("PreToolUse"));

    expect(() =>
      projector.project("PostToolUse", {
        ...(hook("PostToolUse") as Record<string, unknown>),
        conversationId: "different-conversation",
      }),
    ).toThrow("AGY hook conversationId changed during the run");
  });

  it("emits terminal events only for fully-idle Stop and classifies documented failures", () => {
    const base = hook("Stop") as Record<string, unknown>;
    const projector = new AgyHookProjector(testIds());

    expect(
      projector.project("Stop", { ...base, fullyIdle: false }).at(-1)?.kind,
    ).toBe("session_started");
    projector.project("Stop", { ...base, error: "hook failed" });
    expect(projector.completeStdout("").at(-1)?.kind).toBe("run_failed");
    expect(
      (() => {
        const failed = new AgyHookProjector(testIds());
        failed.project("Stop", {
          ...base,
          terminationReason: "max_steps_exceeded",
        });
        return failed.completeStdout("").at(-1)?.kind;
      })(),
    ).toBe("run_failed");
  });

  it("exposes textual PostToolUse errors without granting an approval decision", () => {
    const native = {
      ...(hook("PostToolUse") as Record<string, unknown>),
      error: "permission denied",
    };
    const event = new AgyHookProjector(testIds())
      .project("PostToolUse", native)
      .at(-1);

    expect(event?.payload).toMatchObject({
      isError: true,
      output: "permission denied",
    });
    expect(event?.payload).not.toHaveProperty("decision");
  });

  it("fails closed for malformed common paths and indices", () => {
    const native = hook("PreToolUse") as Record<string, unknown>;

    expect(() =>
      parseAgyHook("PreToolUse", {
        ...native,
        transcriptPath: "relative.jsonl",
      }),
    ).toThrow();
    expect(() =>
      parseAgyHook("PreToolUse", { ...native, workspacePaths: ["relative"] }),
    ).toThrow();
    expect(() =>
      parseAgyHook("PreToolUse", { ...native, stepIdx: -1 }),
    ).toThrow();
    expect(() =>
      parseAgyHook("PreInvocation", {
        ...(hook("PreInvocation") as Record<string, unknown>),
        invocationNum: 1.5,
      }),
    ).toThrow();
    expect(() =>
      parseAgyHook("PreInvocation", {
        ...(hook("PreInvocation") as Record<string, unknown>),
        initialNumSteps: -1,
      }),
    ).toThrow();
    expect(() =>
      parseAgyHook("Stop", {
        ...(hook("Stop") as Record<string, unknown>),
        executionNum: -1,
      }),
    ).toThrow();
    expect(() =>
      parseAgyHook("Stop", {
        ...(hook("Stop") as Record<string, unknown>),
        terminationReason: "",
      }),
    ).toThrow();
    const stopWithoutReason = {
      ...(hook("Stop") as Record<string, unknown>),
    };
    delete stopWithoutReason.terminationReason;
    expect(() => parseAgyHook("Stop", stopWithoutReason)).toThrow();
    expect(() =>
      parseAgyHook("PostToolUse", {
        ...(hook("PostToolUse") as Record<string, unknown>),
        error: null,
      }),
    ).toThrow();
  });

  it("parses transcript envelopes without projecting undocumented content", () => {
    const native = transcript();
    const parsed = native.map((line) => parseAgyTranscriptLine(line));

    expect(parsed[1]).toMatchObject({
      stepIndex: 1,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      content: "Sanitized planner response",
      native: native[1],
    });
    expect(() =>
      parseAgyTranscriptLine({
        ...(native[0] as Record<string, unknown>),
        step_index: -1,
      }),
    ).toThrow();
  });
});
