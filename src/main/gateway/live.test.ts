import { copyFile, chmod, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { newRunId } from "../../shared/ids";
import { JsonlProcess } from "../runtime/transport";
import { startClaudeLiveHarness } from "../runtime/claude/test-harness";
import { claudeGatewayEnvironment } from "../runtime/claude/command";
import { subscriptionEnvironment } from "../runtime/codex/adapter";
import { CodexClient } from "../runtime/codex/client";
import {
  createChatGptBridge,
  createCodexChatGptBackend,
} from "./bridges/chatgpt";
import { createGatewayProfile } from "./profile";
import { startGatewayServer } from "./server";

const SMOKE_PROMPT = "Reply with exactly OKAMI_GATEWAY_SMOKE";
const CHATGPT_MODEL = process.env.OKAMI_GATEWAY_LIVE_MODEL ?? "gpt-5.4";

describe.skipIf(process.env.OKAMI_RUN_LIVE_CLI_TESTS !== "1")(
  "Subscription Gateway live smoke",
  () => {
    it("uses one Claude-harness turn billed only to ChatGPT", async () => {
      const profile = createGatewayProfile({
        id: "chatgpt-live",
        provider: "chatgpt",
        kind: "bridged",
        env: {},
        displayQuotaAccount: "ChatGPT subscription",
      });
      const gateway = await startGatewayServer({
        profiles: [
          {
            profile,
            bridge: createChatGptBridge(createCodexChatGptBackend(), {
              model: "gpt-5.6-sol",
            }),
          },
        ],
      });
      const environment = claudeGatewayEnvironment({
        profile,
        port: gateway.port,
        bearerToken: gateway.bearerToken,
        model: CHATGPT_MODEL,
      });
      const quota = await startCodexQuotaClient();
      const claude = await startClaudeLiveHarness();
      const runId = newRunId();
      try {
        expect(environment.ANTHROPIC_BASE_URL).toBe(
          `${gateway.baseUrl}/${profile.id}`,
        );
        expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
        expect(environment.ANTHROPIC_AUTH_TOKEN).toBe(gateway.bearerToken);
        expect(environment.CLAUDE_CONFIG_DIR).toBeTypeOf("string");
        expect(
          Object.keys(profile.env).filter((key) =>
            key.toUpperCase().startsWith("ANTHROPIC_"),
          ),
        ).toEqual([]);
        expect(
          unexpectedAnthropicCredentials(
            environment,
            gateway.bearerToken,
            CHATGPT_MODEL,
          ),
        ).toEqual([]);

        process.stdout.write(
          `Gateway live runtime/model: claude harness / ${CHATGPT_MODEL} on ChatGPT subscription\n`,
        );
        const before = await quota.client.readRateLimits();
        process.stdout.write(
          `ChatGPT rate-limit usage before: ${JSON.stringify(usedPercentages(before))}\n`,
        );

        const session = await claude.adapter.start({
          laneId: claude.laneId,
          cwd: process.cwd(),
          model: CHATGPT_MODEL,
          env: environment,
        });
        const run = await claude.adapter.sendTurn({
          runId,
          laneId: claude.laneId,
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
        expect(reply).toContain("OKAMI_GATEWAY_SMOKE");

        const after = await quota.client.readRateLimits();
        const beforeUsage = usedPercentages(before);
        const afterUsage = usedPercentages(after);
        process.stdout.write(
          `ChatGPT rate-limit usage after: ${JSON.stringify(afterUsage)}\n`,
        );
        expect(
          afterUsage.some(
            (value, index) => value > (beforeUsage[index] ?? value),
          ),
        ).toBe(true);
      } finally {
        await claude.adapter.cancel(runId);
        await claude.close();
        await gateway.close();
        await quota.close();
      }
    }, 300_000);
  },
);

async function startCodexQuotaClient(): Promise<{
  client: CodexClient;
  close(): Promise<void>;
}> {
  const codexHome = await mkdtemp(path.join(tmpdir(), "okami-gateway-live-"));
  await chmod(codexHome, 0o700);
  await copyFile(
    path.join(homedir(), ".codex", "auth.json"),
    path.join(codexHome, "auth.json"),
  );
  const transport = await JsonlProcess.spawn(
    "codex",
    ["app-server", "--stdio"],
    { env: subscriptionEnvironment({ CODEX_HOME: codexHome }) },
  );
  const client = new CodexClient(transport);
  await client.initialize();
  return {
    client,
    async close() {
      await client.close();
      await rm(codexHome, { recursive: true, force: true });
    },
  };
}

function usedPercentages(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(usedPercentages);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "usedPercent" && typeof entry === "number"
      ? [entry]
      : usedPercentages(entry),
  );
}

function unexpectedAnthropicCredentials(
  environment: NodeJS.ProcessEnv,
  gatewayToken: string,
  model: string,
): string[] {
  return Object.entries(environment)
    .filter(([key, value]) => {
      if (!key.toUpperCase().startsWith("ANTHROPIC_")) return false;
      if (key === "ANTHROPIC_BASE_URL") return false;
      if (key === "ANTHROPIC_CUSTOM_MODEL_OPTION" && value === model) {
        return false;
      }
      return key !== "ANTHROPIC_AUTH_TOKEN" || value !== gatewayToken;
    })
    .map(([key]) => key);
}
