import { describe, expect, it, vi } from "vitest";
import type { TaskId } from "../../shared/ids";
import { ProviderRuntimeAdapter } from "./sdk/provider-runtime";
import { createRuntimeRegistry } from "./registry";

it("registers provider runtimes instead of exposing CLI adapters as providers", () => {
  const registry = createRuntimeRegistry({
    claude: {} as never,
    codex: {} as never,
    cursor: {} as never,
    agy: {} as never,
    grok: {} as never,
    mimo: {} as never,
    minimax: {} as never,
    opencode: {} as never,
  });

  expect(registry.lookup("agy")).toBeInstanceOf(ProviderRuntimeAdapter);
  expect(registry.lookup("grok")).toBeInstanceOf(ProviderRuntimeAdapter);
  expect(registry.lookup("mimo")).toBeInstanceOf(ProviderRuntimeAdapter);
  expect(registry.lookup("minimax")).toBeInstanceOf(ProviderRuntimeAdapter);
  expect(registry.manifest("cursor")).toMatchObject({
    runtimeId: "cursor",
    providerId: "cursor",
    transports: [
      expect.objectContaining({
        id: "cursor-agent",
        kind: "cli",
        authentication: "browser_subscription",
      }),
    ],
  });
  expect(registry.manifests()).toHaveLength(8);
});

describe("RuntimeRegistry health", () => {
  it("uses subscription and Token Plan transports without any pay-as-you-go candidate", async () => {
    const registry = createRuntimeRegistry({
      claude: {} as never,
      codex: {} as never,
      cursor: {} as never,
      agy: {} as never,
      grok: {} as never,
      mimo: {} as never,
      minimax: {} as never,
      opencode: {} as never,
      responses: {
        mimo: {
          kind: "mimo",
          transportId: "mimo-token-plan",
          baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
          credentialReference: "MIMO_TOKEN_PLAN_KEY",
          credential: { get: async () => "tp-okami-mimo" },
          taskIdForRun: async () =>
            "33333333-3333-4333-8333-333333333333" as TaskId,
        },
      },
      chatCompletions: {
        minimax: {
          kind: "minimax",
          transportId: "minimax-token-plan",
          baseUrl: "https://api.minimax.io/v1",
          credentialReference: "MINIMAX_TOKEN_PLAN_KEY",
          credential: { get: async () => "sk-cp-okami-minimax" },
          taskIdForRun: async () =>
            "33333333-3333-4333-8333-333333333333" as TaskId,
        },
      },
    });

    expect(registry.manifest("codex")?.transports).toEqual([
      expect.objectContaining({
        id: "codex-managed",
        entitlement: "subscription",
      }),
    ]);
    expect(registry.manifest("grok")?.transports).toEqual([
      expect.objectContaining({
        id: "grok-managed",
        entitlement: "subscription",
      }),
    ]);
    expect(registry.manifest("mimo")?.transports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mimo-token-plan",
          entitlement: "token_plan",
        }),
      ]),
    );
    expect(registry.manifest("minimax")?.transports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "minimax-token-plan",
          entitlement: "token_plan",
        }),
      ]),
    );
    await expect(registry.health("mimo")).resolves.toMatchObject({
      health: {
        available: true,
        transportId: "mimo-token-plan",
        transportKind: "api",
      },
    });
    await expect(registry.health("minimax")).resolves.toMatchObject({
      health: {
        available: true,
        transportId: "minimax-token-plan",
        transportKind: "api",
      },
    });
  });

  it("reports health for every registered runtime from the same registry", async () => {
    const registry = createRuntimeRegistry({
      claude: {} as never,
      codex: {} as never,
      cursor: {} as never,
      agy: {} as never,
      grok: {} as never,
      mimo: {} as never,
      minimax: {} as never,
      opencode: {} as never,
    });
    const detected = vi.fn(async () => ({
      available: true,
      protocolSupported: true,
      version: "test",
    }));
    for (const manifest of registry.manifests()) {
      const adapter = registry.lookup(manifest.runtimeId as never);
      if (adapter) adapter.detect = detected;
    }

    const health = await registry.healthAll();

    expect(health).toHaveLength(registry.manifests().length);
    expect(health).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifest: expect.objectContaining({ runtimeId: "opencode" }),
          health: expect.objectContaining({ available: true }),
        }),
      ]),
    );
    expect(detected).toHaveBeenCalledTimes(8);
  });
});
