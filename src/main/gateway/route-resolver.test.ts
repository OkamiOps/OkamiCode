import { describe, expect, it } from "vitest";
import { createGatewayProfile } from "./profile";
import { resolveRoute, type GatewayAccount } from "./route-resolver";

function accountsFixture(): GatewayAccount[] {
  return [
    {
      provider: "chatgpt",
      bridgedProfile: createGatewayProfile({
        id: "chatgpt-default",
        provider: "chatgpt",
        kind: "bridged",
        env: { CODEX_HOME: "/tmp/okami-codex" },
        displayQuotaAccount: "ChatGPT Plus",
      }),
      nativeRuntime: "codex",
    },
  ];
}

describe("resolveRoute", () => {
  it("routes a GPT lane through the claude harness on the chatgpt profile", () => {
    const route = resolveRoute({ model: "gpt", accounts: accountsFixture() });
    expect(route).toMatchObject({
      harness: "claude",
      kind: "bridged",
      profile: { provider: "chatgpt" },
      reason: "subscription_bridge",
      displayQuotaAccount: "ChatGPT Plus",
    });
  });

  it("never places anthropic credentials in a non-claude profile", () => {
    const route = resolveRoute({ model: "gpt", accounts: accountsFixture() });
    if (route.kind !== "bridged" && route.kind !== "compatible") {
      throw new Error("Expected a gateway route");
    }
    expect(JSON.stringify(route.profile.env)).not.toMatch(/anthropic|claude/i);
    expect(route.profile.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("prefers an official compatible profile over a bridge", () => {
    const compatible = createGatewayProfile({
      id: "mimo-compatible",
      provider: "mimo",
      kind: "compatible",
      env: { MIMO_API_TOKEN: "fixture-token" },
      displayQuotaAccount: "MiMo Coding Plan",
    });
    const bridged = createGatewayProfile({
      ...compatible,
      id: "mimo-bridge",
      kind: "bridged",
    });
    const route = resolveRoute({
      model: "mimo",
      accounts: [
        {
          provider: "mimo",
          compatibleProfile: compatible,
          bridgedProfile: bridged,
        },
      ],
    });
    expect(route).toMatchObject({
      harness: "claude",
      kind: "compatible",
      profile: { id: "mimo-compatible" },
      reason: "official_compatible",
    });
  });

  it("falls back to the native runtime explicitly when the bridge is unhealthy", () => {
    const route = resolveRoute({
      model: "gpt",
      accounts: accountsFixture(),
      health: { chatgpt: "unhealthy" },
    });
    expect(route).toMatchObject({
      harness: "native",
      kind: "native",
      runtime: "codex",
      reason: "bridge_unhealthy",
      displayQuotaAccount: "ChatGPT Plus",
    });
  });

  it("uses the native runtime only when explicitly requested", () => {
    const route = resolveRoute({
      model: "gpt",
      accounts: accountsFixture(),
      preferNative: true,
    });
    expect(route).toMatchObject({
      harness: "native",
      kind: "native",
      runtime: "codex",
      reason: "native_requested",
    });
  });

  it("routes claude models directly without the gateway", () => {
    const route = resolveRoute({
      model: "claude",
      accounts: accountsFixture(),
    });
    expect(route).toMatchObject({
      harness: "claude",
      kind: "direct",
      runtime: "claude",
      reason: "claude_model",
      displayQuotaAccount: "Claude subscription",
    });
    expect("profile" in route).toBe(false);
  });
});
