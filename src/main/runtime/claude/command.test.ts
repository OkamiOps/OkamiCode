import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayProfile } from "../../gateway/profile";
import {
  claudeArgs,
  claudeEnvironment,
  claudeGatewayEnvironment,
} from "./command";

const gatewayConfigDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...gatewayConfigDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  gatewayConfigDirectories.clear();
});

describe("Claude launch environment", () => {
  it("passes the selected provider model to the Claude harness", () => {
    const args = claudeArgs({
      settingsPath: "/tmp/settings.json",
      sessionId: "session-id",
      model: "gpt-5.2",
    });
    expect(args.slice(args.indexOf("--model"))).toEqual(["--model", "gpt-5.2"]);
  });

  it("removes inherited provider credentials and gateway overrides", () => {
    const environment = claudeEnvironment({
      ANTHROPIC_API_KEY: "forbidden-fixture-value",
      ANTHROPIC_AUTH_TOKEN: "forbidden-fixture-value",
      ANTHROPIC_BASE_URL: "https://wrong.example",
      ANTHROPIC_CUSTOM_HEADERS: "x-secret: forbidden-fixture-value",
      ANTHROPIC_CUSTOM_MODEL_OPTION: "wrong-model",
      ANTHROPIC_MODEL: "wrong-model",
      OPENAI_API_KEY: "forbidden-fixture-value",
    });
    expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
    expect(environment.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(environment.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(environment.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    expect(environment.ANTHROPIC_CUSTOM_MODEL_OPTION).toBeUndefined();
    expect(environment.ANTHROPIC_MODEL).toBeUndefined();
    expect(environment.OPENAI_API_KEY).toBeUndefined();
  });

  it("leaves the user's Claude config directory unchanged for direct lanes", () => {
    const environment = claudeEnvironment({
      CLAUDE_CONFIG_DIR: "/tmp/user-claude-config",
    });

    expect(environment.CLAUDE_CONFIG_DIR).toBe("/tmp/user-claude-config");
  });

  it("creates a unique private Claude config directory for each gateway lane", async () => {
    const profile = createGatewayProfile({
      id: "chatgpt-default",
      provider: "chatgpt",
      kind: "bridged",
      env: {},
      displayQuotaAccount: "ChatGPT Plus",
    });
    const first = claudeGatewayEnvironment({
      profile,
      port: 43123,
      bearerToken: "gateway-session-token",
      model: "gpt-5.2",
    });
    const second = claudeGatewayEnvironment({
      profile,
      port: 43123,
      bearerToken: "gateway-session-token",
      model: "gpt-5.2",
    });
    const directories = [first.CLAUDE_CONFIG_DIR, second.CLAUDE_CONFIG_DIR];

    for (const directory of directories) {
      expect(directory).toBeTypeOf("string");
      if (!directory) throw new Error("Missing gateway Claude config dir");
      gatewayConfigDirectories.add(directory);
      expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
    expect(directories[0]).not.toBe(directories[1]);
  });

  it("adds only the loopback gateway endpoint and per-session bearer", () => {
    const profile = createGatewayProfile({
      id: "chatgpt-default",
      provider: "chatgpt",
      kind: "bridged",
      env: { CODEX_HOME: "/tmp/okami-codex" },
      displayQuotaAccount: "ChatGPT Plus",
    });
    const environment = claudeGatewayEnvironment({
      profile,
      port: 43123,
      bearerToken: "gateway-session-token",
      model: "gpt-5.2",
    });

    expect(environment).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:43123/chatgpt-default",
      ANTHROPIC_AUTH_TOKEN: "gateway-session-token",
      ANTHROPIC_CUSTOM_MODEL_OPTION: "gpt-5.2",
      CODEX_HOME: "/tmp/okami-codex",
    });
    expect(environment.CLAUDE_CONFIG_DIR).toBeTypeOf("string");
    if (environment.CLAUDE_CONFIG_DIR) {
      gatewayConfigDirectories.add(environment.CLAUDE_CONFIG_DIR);
    }
    expect(environment.ANTHROPIC_API_KEY).toBeUndefined();
    expect(profile.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
});
