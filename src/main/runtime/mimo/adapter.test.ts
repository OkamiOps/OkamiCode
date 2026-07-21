import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { MimoAdapter } from "./adapter";

const laneId = "22222222-2222-4222-8222-222222222222" as LaneId;
const runId = "33333333-3333-4333-8333-333333333333" as RunId;

async function collect(events: AsyncIterable<CanonicalEvent>) {
  const result: CanonicalEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe("MimoAdapter", () => {
  it("detects the installed headless JSON protocol without a model turn", async () => {
    const execute = vi.fn(async (_command: string, args: string[]) => ({
      stdout:
        args[0] === "--version"
          ? "0.1.7\n"
          : "mimo run --format json --session id --model model --dir path",
    }));
    const adapter = new MimoAdapter({
      execute,
      taskIdForRun: async () =>
        "11111111-1111-4111-8111-111111111111" as TaskId,
    });

    await expect(adapter.detect()).resolves.toEqual({
      available: true,
      protocolSupported: true,
      version: "0.1.7",
    });
  });

  it("binds the native session from JSON output and completes the run", async () => {
    const messages = [
      {
        type: "text",
        sessionID: "ses_native",
        part: { type: "text", text: "Olá" },
      },
    ];
    const process = {
      next: vi.fn(async () => messages.shift()),
      wait: vi.fn(async () => ({ successOrCancelled: true })),
      cancel: vi.fn(async () => undefined),
    };
    const adapter = new MimoAdapter({
      execute: vi.fn(async (_command: string, args: string[]) => ({
        stdout:
          args[0] === "--version"
            ? "0.1.7\n"
            : "--format json --session --model --dir",
      })),
      spawn: vi.fn(async () => process),
      taskIdForRun: async () =>
        "11111111-1111-4111-8111-111111111111" as TaskId,
      createEventId: (sequence) => `mimo-event-${sequence}`,
    });
    await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "xiaomi/mimo-v2.5",
    });
    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: null,
      input: "Olá",
    });

    expect((await collect(handle.events)).map((event) => event.kind)).toEqual([
      "session_started",
      "message_delta",
      "run_completed",
    ]);
  });
});
