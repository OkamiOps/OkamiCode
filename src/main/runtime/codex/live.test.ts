import { execFile } from "node:child_process";
import { copyFile, chmod, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { JsonlProcess } from "../transport";
import { subscriptionEnvironment } from "./adapter";
import { CodexClient } from "./client";

const execFileAsync = promisify(execFile);

describe.skipIf(process.env.OKAMI_RUN_LIVE_CLI_TESTS !== "1")(
  "Codex app-server live handshake",
  () => {
    it("initializes and reads subscription rate limits without starting a turn", async () => {
      const environment = subscriptionEnvironment();
      const { stdout } = await execFileAsync("codex", ["--version"], {
        env: environment,
      });
      process.stdout.write(`Codex version: ${stdout.trim()}\n`);

      const temporaryCodexHome = await mkdtemp(
        path.join(tmpdir(), "okami-codex-live-"),
      );
      await chmod(temporaryCodexHome, 0o700);
      const temporaryAuth = path.join(temporaryCodexHome, "auth.json");
      await copyFile(
        path.join(homedir(), ".codex", "auth.json"),
        temporaryAuth,
      );
      await chmod(temporaryAuth, 0o600);

      let client: CodexClient | undefined;
      try {
        const transport = await JsonlProcess.spawn(
          "codex",
          ["app-server", "--stdio"],
          {
            env: subscriptionEnvironment({ CODEX_HOME: temporaryCodexHome }),
          },
        );
        client = new CodexClient(transport);
        const initialization = await client.initialize("0.1.0");
        expect(initialization).toMatchObject({ platformOs: "macos" });

        const rateLimits = await client.readRateLimits();
        expect(rateLimits).toEqual(
          expect.objectContaining({ rateLimits: expect.any(Object) }),
        );
        process.stdout.write(
          `Codex rate limits: ${JSON.stringify(redactAccountIdentifiers(rateLimits))}\n`,
        );
        process.stdout.write(
          "Codex live handshake complete: zero turns consumed (no turn request was sent).\n",
        );
      } finally {
        await client?.close();
        await rm(temporaryCodexHome, { recursive: true, force: true });
      }
    }, 30_000);
  },
);

function redactAccountIdentifiers(value: unknown, key = ""): unknown {
  if (/^(?:id|.*Id|email)$/i.test(key) && value !== null) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactAccountIdentifiers(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        redactAccountIdentifiers(entry, entryKey),
      ]),
    );
  }
  return value;
}
