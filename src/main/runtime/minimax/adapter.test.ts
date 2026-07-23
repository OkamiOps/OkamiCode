import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { MiniMaxAdapter } from "./adapter";

it("runs MiniMax Token Plan chat through the installed mmx CLI", async () => {
  const run = vi.fn(() => ({
    result: async () => ({
      stdout: JSON.stringify({
        content: [{ type: "text", text: "Resposta MiniMax" }],
        usage: { input_tokens: 4, output_tokens: 2 },
      }),
      stderr: "",
      success: true,
    }),
    cancel: vi.fn(async () => undefined),
  }));
  const adapter = new MiniMaxAdapter({
    taskIdForRun: () => randomUUID() as TaskId,
    execute: vi.fn(async (_command, args) => ({
      stdout: args.includes("--version")
        ? "mmx 1.0.18\n"
        : "--message --model --output --non-interactive",
      stderr: "",
    })),
    run,
    command: "/nvm/v24/bin/mmx",
    env: { PATH: "/usr/bin:/bin" },
    createEventId: () => randomUUID(),
  });
  const laneId = randomUUID() as LaneId;
  const session = await adapter.start({
    laneId,
    cwd: "/workspace",
    model: "MiniMax-M3",
  });
  const handle = await adapter.sendTurn({
    runId: randomUUID() as RunId,
    laneId,
    nativeSessionId: session.nativeSessionId,
    input: "Responda",
    model: "MiniMax-M3",
  });
  const events = [];
  for await (const event of handle.events) events.push(event);

  expect(events.map((event) => event.kind)).toEqual([
    "session_resumed",
    "message_delta",
    "message_completed",
    "usage_reported",
    "run_completed",
  ]);
  expect(events[1]?.payload).toMatchObject({ delta: "Resposta MiniMax" });
  expect(events[2]?.payload).toMatchObject({ text: "Resposta MiniMax" });
  expect(events[3]?.payload).toEqual({
    runtime: "minimax",
    usage: { input_tokens: 4, output_tokens: 2 },
  });
  expect(run).toHaveBeenCalledWith(
    "/nvm/v24/bin/mmx",
    expect.arrayContaining([
      "text",
      "chat",
      "--model",
      "MiniMax-M3",
      "--message",
      "user:Responda",
      "--output",
      "json",
    ]),
    expect.objectContaining({
      cwd: "/workspace",
      env: expect.objectContaining({
        PATH: "/nvm/v24/bin:/usr/bin:/bin",
      }),
    }),
  );
});
