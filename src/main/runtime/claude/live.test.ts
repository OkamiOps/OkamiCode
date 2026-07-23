import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { newRunId } from "../../../shared/ids";
import { locateLocalBinary } from "../../ecosystem/cli-capabilities";
import { claudeEnvironment } from "./command";
import { startClaudeLiveHarness } from "./test-harness";

const execFileAsync = promisify(execFile);
const SMOKE_PROMPT = "Reply with exactly OKAMI_CLAUDE_SMOKE";

describe.skipIf(process.env.OKAMI_RUN_LIVE_CLI_TESTS !== "1")(
  "Claude Code live smoke",
  () => {
    it("uses subscription auth for exactly one smoke turn", async () => {
      const environment = claudeEnvironment();
      expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
      expect(environment.OPENAI_API_KEY).toBeUndefined();

      const command = locateLocalBinary("claude");
      expect(command).toBeTruthy();
      const [{ stdout: version }, { stdout: authOutput }] = await Promise.all([
        execFileAsync(command!, ["--version"], { env: environment }),
        execFileAsync(command!, ["auth", "status", "--json"], {
          env: environment,
        }),
      ]);
      const auth = JSON.parse(authOutput) as {
        authMethod?: string;
        loggedIn?: boolean;
        subscriptionType?: string;
      };
      const visibleLog = [
        `Claude version: ${version.trim()}`,
        `Claude auth source: ${auth.authMethod ?? "unknown"} (${auth.subscriptionType ?? "unknown"})`,
      ];
      visibleLog.forEach((line) => process.stdout.write(`${line}\n`));

      expect(auth.loggedIn).toBe(true);
      expect(process.env.OKAMI_LIVE_PROMPT ?? SMOKE_PROMPT).toBe(SMOKE_PROMPT);
      const harness = await startClaudeLiveHarness({ command: command! });
      const runId = newRunId();
      try {
        const session = await harness.adapter.start({
          laneId: harness.laneId,
          cwd: process.cwd(),
        });
        const run = await harness.adapter.sendTurn({
          runId,
          laneId: harness.laneId,
          nativeSessionId: session.nativeSessionId,
          input: SMOKE_PROMPT,
        });
        const events = [];
        for await (const event of run.events) events.push(event);
        const reply = events
          .filter((event) => event.kind === "message_completed")
          .map((event) => event.payload.text)
          .filter((text): text is string => typeof text === "string")
          .join("")
          .trim();

        process.stdout.write(`Claude reply: ${reply}\n`);
        // The smoke proves transport + auth, not verbatim model obedience.
        expect(reply).toContain("OKAMI_CLAUDE_SMOKE");
        expect(visibleLog.join("\n")).not.toMatch(
          /(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|sk-ant-)/,
        );
      } finally {
        await harness.adapter.cancel(runId);
        await harness.close();
      }
      // User-level SessionStart hooks can delay system/init by 90s+ before the turn even starts.
    }, 300_000);
  },
);
