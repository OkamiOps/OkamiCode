import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { CursorAdapter } from "./adapter";

type NativeRecord = Record<string, unknown>;

function fixture(
  name: "adapter-process-failure" | "adapter-turn",
): NativeRecord[] {
  return readFileSync(`tests/fixtures/runtime/cursor/${name}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as NativeRecord);
}

class FakeProcess {
  readonly cancel = vi.fn(async () => undefined);
  readonly wait = vi.fn(async () => ({ successOrCancelled: true }));

  constructor(private readonly messages: NativeRecord[]) {}

  next(): Promise<NativeRecord | undefined> {
    return Promise.resolve(this.messages.shift());
  }
}

function healthyExecutor(createChatOutput = "chat-123\n") {
  return vi.fn(async (_command: string, args: string[]) => {
    const key = args.join(" ");
    if (key === "--version") {
      return { stdout: "cursor-agent 2026.07.17-3e2a980\n" };
    }
    if (key === "--help") {
      return {
        stdout:
          "Usage: cursor-agent --print --output-format stream-json --stream-partial-output --resume=<id> --mode plan --auto-review --sandbox enabled create-chat",
      };
    }
    if (key === "create-chat --help") {
      return { stdout: "Usage: cursor-agent create-chat" };
    }
    if (key === "create-chat") return { stdout: createChatOutput };
    throw new Error(`Unexpected command: ${key}`);
  });
}

function dependencies(
  messages: NativeRecord[] = fixture("adapter-turn"),
  execute = healthyExecutor(),
) {
  const process = new FakeProcess(messages);
  const spawn =
    vi.fn<
      (
        command: string,
        args: string[],
        options?: { cwd?: string; env?: NodeJS.ProcessEnv },
      ) => Promise<FakeProcess>
    >();
  spawn.mockResolvedValue(process);
  return {
    execute,
    process,
    spawn,
    taskIdForRun: vi.fn(
      async () => "11111111-1111-4111-8111-111111111111" as TaskId,
    ),
    createEventId: (sequence: number) => `cursor-adapter-event-${sequence}`,
  };
}

async function collect(events: AsyncIterable<CanonicalEvent>) {
  const collected: CanonicalEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

const laneId = "22222222-2222-4222-8222-222222222222" as LaneId;
const runId = "33333333-3333-4333-8333-333333333333" as RunId;

describe("CursorAdapter", () => {
  it("detects the direct cursor-agent protocol capabilities without a live turn", async () => {
    const deps = dependencies();
    const adapter = new CursorAdapter(deps);

    await expect(adapter.detect()).resolves.toEqual({
      available: true,
      protocolSupported: true,
      version: "2026.07.17-3e2a980",
    });
    expect(deps.execute.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["cursor-agent", ["--version"]],
      ["cursor-agent", ["--help"]],
      ["cursor-agent", ["create-chat", "--help"]],
    ]);

    const missing = dependencies(
      [],
      vi.fn(async (_command: string, args: string[]) => ({
        stdout:
          args[0] === "--version"
            ? "cursor-agent 1.2.3"
            : args[0] === "create-chat"
              ? "Usage: create-chat"
              : "--print --output-format stream-json --resume=<id> --mode plan --auto-review --sandbox enabled",
      })),
    );
    await expect(new CursorAdapter(missing).detect()).resolves.toMatchObject({
      available: true,
      protocolSupported: false,
      detail: expect.stringContaining("--stream-partial-output"),
    });
  });

  it("starts with create-chat only and resumes without invoking a model", async () => {
    const deps = dependencies();
    const adapter = new CursorAdapter(deps);
    const started = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "cursor-model",
    });
    const resumed = await adapter.resume({
      laneId,
      cwd: "/workspace-two",
      nativeSessionId: "chat-existing",
    });

    expect(started).toMatchObject({
      laneId,
      nativeSessionId: "chat-123",
      runtimeVersion: "2026.07.17-3e2a980",
    });
    expect(resumed.nativeSessionId).toBe("chat-existing");
    const createCalls = deps.execute.mock.calls.filter(
      (call) => call[1]?.[0] === "create-chat" && call[1].length === 1,
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject([
      "cursor-agent",
      ["create-chat"],
      { cwd: "/workspace", env: expect.any(Object) },
    ]);
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it("rejects malformed create-chat output", async () => {
    const deps = dependencies([], healthyExecutor("created chat: invalid\n"));

    await expect(
      new CursorAdapter(deps).start({ laneId, cwd: "/workspace" }),
    ).rejects.toThrow("Cursor create-chat returned an invalid session id");
  });

  it("runs one-shot resumed stream-json turns and validates authoritative init", async () => {
    const deps = dependencies();
    const adapter = new CursorAdapter(deps);
    await adapter.resume({
      laneId,
      cwd: "/workspace",
      nativeSessionId: "chat-123",
    });
    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "chat-123",
      input: "Inspect",
      model: "cursor-model",
    });
    const events = await collect(handle.events);

    expect(events.map((event) => event.kind)).toEqual([
      "session_resumed",
      "message_delta",
      "run_completed",
    ]);
    expect(deps.spawn).toHaveBeenCalledWith(
      "cursor-agent",
      [
        "-p",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--sandbox",
        "enabled",
        "--model",
        "cursor-model",
        "--resume=chat-123",
        "Inspect",
      ],
      { cwd: "/workspace", env: expect.any(Object) },
    );
    const args = deps.spawn.mock.calls[0]?.[1] ?? [];
    expect(args.at(-1)).toBe("Inspect");
    expect(args).not.toEqual(
      expect.arrayContaining([
        "--force",
        "--yolo",
        "--approve-mcps",
        "--trust",
      ]),
    );
  });

  it("fails closed when system/init binds a different session", async () => {
    const messages = fixture("adapter-turn");
    messages[0] = { ...messages[0], session_id: "different-chat" };
    const deps = dependencies(messages);
    const adapter = new CursorAdapter(deps);
    await adapter.resume({
      laneId,
      cwd: "/workspace",
      nativeSessionId: "chat-123",
    });
    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "chat-123",
      input: "Inspect",
    });

    await expect(collect(handle.events)).rejects.toThrow(
      "Cursor system/init session_id does not match the resumed session",
    );
    expect(deps.process.cancel).toHaveBeenCalledOnce();
    expect(deps.process.wait).toHaveBeenCalledOnce();
  });

  it("fails closed when output arrives before system/init", async () => {
    const deps = dependencies(fixture("adapter-turn").slice(1));
    const adapter = new CursorAdapter(deps);
    await adapter.resume({
      laneId,
      cwd: "/workspace",
      nativeSessionId: "chat-123",
    });
    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "chat-123",
      input: "Inspect",
    });

    await expect(collect(handle.events)).rejects.toThrow(
      "Cursor stream emitted output before system/init",
    );
  });

  it("synthesizes an honest failure when the process exits without a result", async () => {
    const deps = dependencies(fixture("adapter-process-failure"));
    const adapter = new CursorAdapter(deps);
    await adapter.resume({
      laneId,
      cwd: "/workspace",
      nativeSessionId: "chat-123",
    });
    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "chat-123",
      input: "Inspect",
    });
    const events = await collect(handle.events);

    expect(events.at(-1)).toMatchObject({
      kind: "run_failed",
      payload: { reason: "cursor_process_ended_without_terminal_result" },
    });
  });

  it("preserves safe permission mode argv and rejects unsafe modes before spawn", async () => {
    const planDeps = dependencies();
    const planAdapter = new CursorAdapter(planDeps);
    await planAdapter.resume({
      laneId,
      cwd: "/workspace",
      nativeSessionId: "chat-123",
      permissionMode: "plan",
    });
    await planAdapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "chat-123",
      input: "Inspect",
      model: "default",
    });
    const planArgs = planDeps.spawn.mock.calls[0]?.[1] ?? [];
    expect(planArgs).toEqual(
      expect.arrayContaining(["--mode", "plan", "--sandbox", "enabled"]),
    );
    expect(planArgs).not.toContain("--model");

    for (const permissionMode of [
      "acceptEdits",
      "bypassPermissions",
    ] as const) {
      const deps = dependencies();
      const adapter = new CursorAdapter(deps);
      await adapter.resume({
        laneId,
        cwd: "/workspace",
        nativeSessionId: "chat-123",
        permissionMode,
      });
      await expect(
        adapter.sendTurn({
          runId,
          laneId,
          nativeSessionId: "chat-123",
          input: "Inspect",
        }),
      ).rejects.toThrow(
        `Cursor does not safely support permission mode ${permissionMode}`,
      );
      expect(deps.spawn).not.toHaveBeenCalled();
    }
  });

  it("emits exactly one cancellation terminal while the stream is consumed", async () => {
    const deps = dependencies();
    const adapter = new CursorAdapter(deps);
    await adapter.resume({
      laneId,
      cwd: "/workspace",
      nativeSessionId: "chat-123",
    });
    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "chat-123",
      input: "Inspect",
    });

    await adapter.cancel(runId);
    await expect(
      adapter.sendTurn({
        runId,
        laneId,
        nativeSessionId: "chat-123",
        input: "Duplicate",
      }),
    ).rejects.toThrow(`Cursor run ${runId} is already active`);
    const events = await collect(handle.events);
    const terminalKinds = events
      .map((event) => event.kind)
      .filter((kind) => kind.startsWith("run_"));

    expect(terminalKinds).toEqual(["run_cancelled"]);
    expect(deps.process.cancel).toHaveBeenCalledOnce();
    expect(deps.process.wait).toHaveBeenCalledOnce();
  });

  it("rejects unsupported approvals and reports no usage capabilities", async () => {
    const deps = dependencies();
    const adapter = new CursorAdapter(deps);
    await adapter.resume({
      laneId,
      cwd: "/workspace",
      nativeSessionId: "chat-123",
    });
    await expect(
      adapter.respondToApproval({
        runId,
        approvalId: "approval-1",
        decision: "deny",
      }),
    ).rejects.toThrow("Cursor approvals are not supported");
    expect(adapter.usageCapabilities()).toEqual({
      quotaSnapshot: false,
      contextSnapshot: false,
      activitySnapshot: false,
    });
  });
});
