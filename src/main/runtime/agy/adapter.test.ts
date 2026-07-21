// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import {
  AgyAdapter,
  EventQueue,
  type AgyCompanion,
  type AgyProcess,
} from "./adapter";

const laneId = "22222222-2222-4222-8222-222222222222" as LaneId;
const runId = "33333333-3333-4333-8333-333333333333" as RunId;
const workspace = "/redacted/workspace";
const fixtureDirectory = fileURLToPath(
  new URL("../../../../tests/fixtures/runtime/agy/", import.meta.url),
);

function hook(name: "pre-invocation" | "pre-tool-use" | "stop"): unknown {
  return JSON.parse(
    readFileSync(path.join(fixtureDirectory, `${name}.json`), "utf8"),
  ) as unknown;
}

function hookForConversation(
  name: "pre-invocation" | "pre-tool-use" | "stop",
  conversationId: string,
): unknown {
  return { ...(hook(name) as Record<string, unknown>), conversationId };
}

class FakeProcess implements AgyProcess {
  readonly cancel = vi.fn(async () => undefined);
  private resolve!: (result: {
    exitCode: number;
    stdout: string;
    stdoutExceeded?: boolean;
  }) => void;
  private readonly completion = new Promise<{
    exitCode: number;
    stdout: string;
    stdoutExceeded?: boolean;
  }>((resolve) => {
    this.resolve = resolve;
  });

  wait() {
    return this.completion;
  }

  finish(
    result: { exitCode: number; stdout: string; stdoutExceeded?: boolean } = {
      exitCode: 0,
      stdout: "Final answer",
    },
  ) {
    this.resolve(result);
  }
}

function dependencies() {
  let onHook:
    | ((envelope: {
        hookName: string;
        payload: unknown;
      }) => Promise<{ decision: "allow" | "deny" } | undefined>)
    | undefined;
  const companion: AgyCompanion = {
    start: vi.fn(async () => undefined),
    hookEnvironment: vi.fn((base) => ({
      ...base,
      OKAMI_AGY_HOOK_SOCKET: "fake",
    })),
    close: vi.fn(async () => undefined),
  };
  const process = new FakeProcess();
  const execute = vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === "--version") return { stdout: "agy 1.2.3\n" };
    if (args[0] === "--help") {
      return { stdout: "--print --conversation --add-dir --sandbox" };
    }
    throw new Error(`unexpected probe ${args.join(" ")}`);
  });
  const spawn = vi.fn<
    (
      command: string,
      args: string[],
      options: { cwd: string; env: NodeJS.ProcessEnv },
    ) => Promise<FakeProcess>
  >(async () => process);
  const pluginStatus = vi.fn(async () => "enabled" as const);
  const authorizer = vi.fn<() => Promise<"allow" | "deny">>(
    async () => "allow",
  );
  const adapter = new AgyAdapter({
    execute,
    spawn,
    pluginStatus,
    authorizer,
    companionFactory: (callback) => {
      onHook = callback;
      return companion;
    },
    taskIdForRun: async () => "11111111-1111-4111-8111-111111111111" as TaskId,
    createEventId: (sequence) => `agy-adapter-${sequence}`,
  });
  return {
    adapter,
    authorizer,
    companion,
    execute,
    emitHook: async (hookName: string, payload: unknown) => {
      if (!onHook) throw new Error("companion callback is unavailable");
      return onHook({ hookName, payload });
    },
    pluginStatus,
    process,
    spawn,
  };
}

async function collect(events: AsyncIterable<CanonicalEvent>) {
  const result: CanonicalEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function event(kind: CanonicalEvent["kind"], sequence: number): CanonicalEvent {
  return {
    schemaVersion: 1,
    id: `event-${sequence}`,
    taskId: "11111111-1111-4111-8111-111111111111",
    laneId,
    runId,
    sequence,
    occurredAt: "2026-07-21T12:00:00.000Z",
    kind,
    nativeEventId: null,
    payload: { runtime: "agy" },
  };
}

describe("AgyAdapter", () => {
  it.each(["run_completed", "run_failed", "run_cancelled"] as const)(
    "retains exactly one %s terminal when the event queue is full",
    async (terminalKind) => {
      const queue = new EventQueue();
      for (let sequence = 0; sequence < 1_024; sequence += 1) {
        expect(queue.push(event("message_delta", sequence))).toBe(true);
      }

      expect(queue.pushTerminal(event(terminalKind, 1_024))).toBe(true);
      expect(queue.pushTerminal(event(terminalKind, 1_025))).toBe(false);
      queue.close();

      const events = await collect(queue);
      expect(events).toHaveLength(1_024);
      expect(events.at(-1)?.kind).toBe(terminalKind);
      expect(
        events.filter((candidate) => candidate.kind === terminalKind),
      ).toHaveLength(1);
    },
  );

  it("detects only the read-only protocol surface and never installs a plugin", async () => {
    const deps = dependencies();

    await expect(deps.adapter.detect()).resolves.toEqual({
      available: true,
      protocolSupported: true,
      version: "1.2.3",
    });
    expect(deps.execute.mock.calls.map((call) => call[1])).toEqual([
      ["--version"],
      ["--help"],
    ]);
    expect(deps.pluginStatus).toHaveBeenCalledOnce();
  });

  it("starts deferred without spawning and resumes only a strict native id", async () => {
    const deps = dependencies();
    await expect(
      deps.adapter.start({
        laneId,
        cwd: workspace,
        model: "agy-model",
        permissionMode: "plan",
        env: { SESSION_ONLY: "yes" },
      }),
    ).resolves.toMatchObject({
      bindingState: "deferred",
      nativeSessionId: null,
    });
    expect(deps.spawn).not.toHaveBeenCalled();

    await expect(
      deps.adapter.resume({
        laneId,
        cwd: workspace,
        nativeSessionId: "native-conversation-7",
      }),
    ).resolves.toMatchObject({ bindingState: "authoritative" });
    await expect(
      deps.adapter.resume({
        laneId,
        cwd: workspace,
        nativeSessionId: " bad id ",
      }),
    ).rejects.toThrow("valid native session id");
  });

  it("runs through the companion before spawn, binds the first hook, and delays Stop until stdout completes", async () => {
    const deps = dependencies();
    await deps.adapter.start({
      laneId,
      cwd: workspace,
      model: "agy-model",
      permissionMode: "plan",
      env: {
        SESSION_ONLY: "yes",
        OPENAI_API_KEY: "must-not-reach-agy",
        ANTHROPIC_API_KEY: "must-not-reach-agy",
        GOOGLE_API_KEY: "must-not-reach-agy",
        GEMINI_API_KEY: "must-not-reach-agy",
      },
    });
    const handle = await deps.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: null,
      input: "Inspect",
    });
    expect(deps.companion.start).toHaveBeenCalledBefore(deps.spawn);
    expect(deps.spawn).toHaveBeenCalledWith(
      "agy",
      [
        "--add-dir",
        workspace,
        "--mode",
        "plan",
        "--sandbox",
        "--model",
        "agy-model",
        "--print",
        "Inspect",
      ],
      {
        cwd: workspace,
        env: expect.objectContaining({
          SESSION_ONLY: "yes",
          OKAMI_AGY_HOOK_SOCKET: "fake",
          PATH: expect.any(String),
        }),
      },
    );
    const spawnEnvironment = deps.spawn.mock.calls[0]?.[2]?.env;
    expect(spawnEnvironment).not.toHaveProperty("OPENAI_API_KEY");
    expect(spawnEnvironment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(spawnEnvironment).not.toHaveProperty("GOOGLE_API_KEY");
    expect(spawnEnvironment).not.toHaveProperty("GEMINI_API_KEY");
    await deps.emitHook("PreInvocation", hook("pre-invocation"));
    await deps.emitHook("Stop", hook("stop"));
    deps.process.finish();

    const events = await collect(handle.events);
    expect(events.map((event) => event.kind)).toEqual([
      "session_started",
      "message_completed",
      "run_completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(deps.companion.close).toHaveBeenCalledOnce();
  });

  it("uses the authoritative conversation for a later turn and fails closed on denied tools", async () => {
    const deps = dependencies();
    deps.authorizer.mockResolvedValue("deny");
    await deps.adapter.resume({
      laneId,
      cwd: workspace,
      nativeSessionId: "conversation-7",
    });
    const handle = await deps.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "conversation-7",
      input: "Inspect",
    });
    expect(deps.spawn.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["--conversation", "conversation-7"]),
    );
    await expect(
      deps.emitHook(
        "PreToolUse",
        hookForConversation("pre-tool-use", "conversation-7"),
      ),
    ).resolves.toEqual({ decision: "deny" });
    expect(deps.authorizer).toHaveBeenCalledOnce();
    await deps.emitHook("Stop", hookForConversation("stop", "conversation-7"));
    deps.process.finish();
    await expect(collect(handle.events)).resolves.toHaveLength(4);
  });

  it("emits one cancellation and cleans up an interrupted run", async () => {
    const deps = dependencies();
    await deps.adapter.start({ laneId, cwd: workspace });
    const handle = await deps.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: null,
      input: "Inspect",
    });
    await deps.adapter.cancel(runId);
    await deps.adapter.cancel(runId);
    deps.process.finish({ exitCode: 143, stdout: "" });

    await expect(collect(handle.events)).resolves.toMatchObject([
      { kind: "run_cancelled", payload: { reason: "user_cancelled" } },
    ]);
    expect(deps.process.cancel).toHaveBeenCalledOnce();
    expect(deps.companion.close).toHaveBeenCalledOnce();
  });

  it("fails honestly when Stop is absent or a hook is outside the lane workspace", async () => {
    const deps = dependencies();
    await deps.adapter.start({ laneId, cwd: workspace });
    const handle = await deps.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: null,
      input: "Inspect",
    });
    await expect(
      deps.emitHook("PreInvocation", {
        ...(hook("pre-invocation") as Record<string, unknown>),
        workspacePaths: ["/another-workspace"],
      }),
    ).resolves.toEqual({ decision: "deny" });
    deps.process.finish();

    await expect(collect(handle.events)).resolves.toMatchObject([
      { kind: "message_completed", payload: { text: "Final answer" } },
      { kind: "run_failed", payload: { reason: "agy_hook_context_mismatch" } },
    ]);
  });

  it("rejects concurrent lane work before a second process can spawn", async () => {
    const deps = dependencies();
    await deps.adapter.start({ laneId, cwd: workspace });
    const first = await deps.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: null,
      input: "Inspect",
    });
    await expect(
      deps.adapter.sendTurn({
        runId: "44444444-4444-4444-8444-444444444444" as RunId,
        laneId,
        nativeSessionId: null,
        input: "Second",
      }),
    ).rejects.toThrow("lane already has an active run");
    expect(deps.spawn).toHaveBeenCalledOnce();
    deps.process.finish({ exitCode: 0, stdout: "" });
    await collect(first.events);
  });

  it("keeps terminal failures singular for missing Stop, oversized stdout, and conversation mismatch", async () => {
    const withoutStop = dependencies();
    await withoutStop.adapter.start({ laneId, cwd: workspace });
    const noStop = await withoutStop.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: null,
      input: "Inspect",
    });
    withoutStop.process.finish();
    await expect(collect(noStop.events)).resolves.toMatchObject([
      { kind: "message_completed" },
      {
        kind: "run_failed",
        payload: { reason: "agy_process_ended_without_stop" },
      },
    ]);

    const oversized = dependencies();
    await oversized.adapter.start({ laneId, cwd: workspace });
    const oversizedHandle = await oversized.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: null,
      input: "Inspect",
    });
    oversized.process.finish({ exitCode: 1, stdout: "", stdoutExceeded: true });
    await expect(collect(oversizedHandle.events)).resolves.toMatchObject([
      { kind: "run_failed", payload: { reason: "agy_stdout_limit_exceeded" } },
    ]);

    const mismatch = dependencies();
    await mismatch.adapter.resume({
      laneId,
      cwd: workspace,
      nativeSessionId: "conversation-7",
    });
    const mismatchHandle = await mismatch.adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "conversation-7",
      input: "Inspect",
    });
    await mismatch.emitHook(
      "PreInvocation",
      hookForConversation("pre-invocation", "conversation-8"),
    );
    mismatch.process.finish({ exitCode: 0, stdout: "" });
    await expect(collect(mismatchHandle.events)).resolves.toMatchObject([
      {
        kind: "run_failed",
        payload: { reason: "agy_hook_conversation_mismatch" },
      },
    ]);
  });
});
