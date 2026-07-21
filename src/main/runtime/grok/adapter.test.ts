import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { GrokAdapter } from "./adapter";

it("detects and runs the documented Grok streaming protocol", async () => {
  const messages = [
    { type: "text", data: "Feito" },
    { type: "end", stopReason: "EndTurn" },
  ];
  const process = {
    next: vi.fn(async () => messages.shift()),
    wait: vi.fn(async () => ({ successOrCancelled: true })),
    cancel: vi.fn(async () => undefined),
  };
  const spawn = vi.fn(async () => process);
  const adapter = new GrokAdapter({
    taskIdForRun: () => randomUUID() as TaskId,
    execute: vi.fn(async (_command, args) => ({
      stdout: args.includes("--version")
        ? "grok 0.2.103\n"
        : "--output-format streaming-json --resume --session-id models",
    })),
    spawn,
    createEventId: () => randomUUID(),
  });
  const laneId = randomUUID() as LaneId;
  const session = await adapter.start({
    laneId,
    cwd: "/workspace",
    model: "grok-build",
  });
  expect(session.bindingState).toBe("authoritative");
  if (session.bindingState !== "authoritative")
    throw new Error("expected session");

  const handle = await adapter.sendTurn({
    runId: randomUUID() as RunId,
    laneId,
    nativeSessionId: session.nativeSessionId,
    input: "Faça",
    model: "grok-build",
    effort: "high",
  });
  const events = [];
  for await (const event of handle.events) events.push(event);

  expect(events.map((event) => event.kind)).toEqual([
    "session_resumed",
    "message_delta",
    "run_completed",
  ]);
  expect(spawn).toHaveBeenCalledWith(
    "grok",
    expect.arrayContaining([
      "--output-format",
      "streaming-json",
      "--session-id",
    ]),
    { cwd: "/workspace" },
  );
});

it("retries a new session when Grok exits before emitting native output", async () => {
  const process = () => ({
    next: vi.fn(async () => undefined),
    wait: vi.fn(async () => ({ successOrCancelled: false })),
    cancel: vi.fn(async () => undefined),
  });
  const spawn = vi.fn(async (...args: [string, string[]]) => {
    void args;
    return process();
  });
  const adapter = new GrokAdapter({
    taskIdForRun: () => randomUUID() as TaskId,
    execute: vi.fn(async (_command, args) => ({
      stdout: args.includes("--version")
        ? "grok 0.2.103\n"
        : "--output-format streaming-json --resume --session-id models",
    })),
    spawn,
  });
  const laneId = randomUUID() as LaneId;
  const session = await adapter.start({ laneId, cwd: "/workspace" });
  if (session.bindingState !== "authoritative")
    throw new Error("expected session");

  for (let turn = 0; turn < 2; turn += 1) {
    const handle = await adapter.sendTurn({
      runId: randomUUID() as RunId,
      laneId,
      nativeSessionId: session.nativeSessionId,
      input: "Tente novamente",
    });
    for await (const _event of handle.events) void _event;
  }

  expect(spawn).toHaveBeenCalledTimes(2);
  for (const call of spawn.mock.calls) {
    expect(call[1]).toContain("--session-id");
    expect(call[1]).not.toContain("--resume");
  }
});
