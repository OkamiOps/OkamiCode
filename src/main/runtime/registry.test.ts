import { describe, expect, it, vi } from "vitest";
import { AgyAdapter } from "./agy/adapter";
import { GrokAdapter } from "./grok/adapter";
import { MimoAdapter } from "./mimo/adapter";
import { MiniMaxAdapter } from "./minimax/adapter";
import { createRuntimeRegistry } from "./registry";

it("registers the native Antigravity adapter", () => {
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

  expect(registry.lookup("agy")).toBeInstanceOf(AgyAdapter);
  expect(registry.lookup("grok")).toBeInstanceOf(GrokAdapter);
  expect(registry.lookup("mimo")).toBeInstanceOf(MimoAdapter);
  expect(registry.lookup("minimax")).toBeInstanceOf(MiniMaxAdapter);
  expect(registry.manifest("cursor")).toMatchObject({
    runtimeId: "cursor",
    providerId: "cursor",
    driver: "native_cli",
    authentication: "browser_subscription",
  });
  expect(registry.manifests()).toHaveLength(8);
});

describe("RuntimeRegistry health", () => {
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
