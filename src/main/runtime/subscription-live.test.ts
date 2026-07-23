import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LaneId, RunId, TaskId } from "../../shared/ids";
import { locateLocalBinary } from "../ecosystem/cli-capabilities";
import type { CanonicalEvent } from "../../shared/contracts/event";
import { CursorAdapter } from "./cursor/adapter";
import { MiniMaxAdapter } from "./minimax/adapter";
import { connectAcpProcess } from "./acp/connection";
import { executableEnvironment } from "./commands";

const live = process.env.OKAMI_RUN_LIVE_CLI_TESTS === "1";

describe.skipIf(!live)("native subscription runtimes live smoke", () => {
  it("runs one Cursor Agent turn through the production adapter", async () => {
    const command = locateLocalBinary("cursor");
    expect(command).toBeTruthy();
    const laneId = randomUUID() as LaneId;
    const adapter = new CursorAdapter({
      command: command!,
      taskIdForRun: () => randomUUID() as TaskId,
    });
    const session = await adapter.start({
      laneId,
      cwd: process.cwd(),
      model: "composer-2.5",
      permissionMode: "manual",
    });
    const run = await adapter.sendTurn({
      runId: randomUUID() as RunId,
      laneId,
      nativeSessionId: session.nativeSessionId,
      input: "Reply exactly OKAMI_CURSOR_SMOKE",
      model: "composer-2.5",
    });
    const events = await collect(run.events);
    const reply = completedText(events);
    process.stdout.write(`Cursor reply: ${reply}\n`);
    expect(reply).toContain("OKAMI_CURSOR_SMOKE");
    expect(events.at(-1)?.kind).toBe("run_completed");
  }, 120_000);

  it("runs one MiniMax Token Plan turn through the production adapter", async () => {
    const command = locateLocalBinary("minimax");
    expect(command).toBeTruthy();
    const laneId = randomUUID() as LaneId;
    const adapter = new MiniMaxAdapter({
      command: command!,
      taskIdForRun: () => randomUUID() as TaskId,
    });
    const session = await adapter.start({
      laneId,
      cwd: process.cwd(),
      model: "MiniMax-M3",
    });
    const run = await adapter.sendTurn({
      runId: randomUUID() as RunId,
      laneId,
      nativeSessionId: session.nativeSessionId,
      input: "Reply exactly OKAMI_MINIMAX_SMOKE",
      model: "MiniMax-M3",
    });
    const events = await collect(run.events);
    const reply = completedText(events);
    process.stdout.write(`MiniMax reply: ${reply}\n`);
    expect(reply).toContain("OKAMI_MINIMAX_SMOKE");
    expect(events.at(-1)?.kind).toBe("run_completed");
  }, 120_000);

  it.skipIf(process.env.OKAMI_RUN_OPENCODE_LIVE_TESTS !== "1")(
    "runs one OpenCode turn through the production ACP transport",
    async () => {
      const command = locateLocalBinary("opencode");
      expect(command).toBeTruthy();
      let reply = "";
      const connection = await connectAcpProcess({
        command: command!,
        args: ["acp", "--cwd", process.cwd()],
        cwd: process.cwd(),
        env: executableEnvironment(command!, { ...process.env }),
        handlers: {
          requestPermission: async () => ({
            outcome: { outcome: "cancelled" },
          }),
          sessionUpdate: async (notification) => {
            if (
              notification.update.sessionUpdate === "agent_message_chunk" &&
              notification.update.content.type === "text"
            ) {
              reply += notification.update.content.text;
            }
          },
        },
      });
      try {
        await connection.initialize();
        const session = await connection.newSession(process.cwd());
        const result = await connection.prompt(
          session.sessionId,
          "Reply exactly OKAMI_OPENCODE_SMOKE",
        );
        process.stdout.write(`OpenCode ACP reply: ${reply}\n`);
        expect(reply).toContain("OKAMI_OPENCODE_SMOKE");
        expect(result.stopReason).not.toBe("cancelled");
      } finally {
        connection.close();
      }
    },
    120_000,
  );
});

async function collect(
  events: AsyncIterable<CanonicalEvent>,
): Promise<CanonicalEvent[]> {
  const collected: CanonicalEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function completedText(events: CanonicalEvent[]): string {
  return events
    .filter((event) => event.kind === "message_completed")
    .map((event) => event.payload.text)
    .filter((text): text is string => typeof text === "string")
    .join("")
    .trim();
}
