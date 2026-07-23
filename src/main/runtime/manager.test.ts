import { describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter, RuntimeHealth } from "./adapter";
import type { RuntimeManifest } from "./manifest";
import { RuntimeManager } from "./manager";

const cursorManifest: RuntimeManifest = {
  schemaVersion: 1,
  runtimeId: "cursor",
  displayName: "Cursor",
  providerId: "cursor",
  driver: "native_cli",
  authentication: "browser_subscription",
  accountStrategy: "cursor_subscription",
  executable: "cursor-agent",
  protocolVersion: "stream-json",
  capabilities: ["sessions", "streaming"],
};

describe("RuntimeManager", () => {
  it("reports manifest and honest protocol health without starting a session", async () => {
    const health: RuntimeHealth = {
      available: true,
      protocolSupported: true,
      version: "2026.07.20-8cc9c0b",
    };
    const detect = vi.fn(async () => health);
    const adapter = {
      kind: "cursor",
      detect,
    } as unknown as RuntimeAdapter;
    const manager = new RuntimeManager({
      clock: () => new Date("2026-07-23T12:30:00.000Z"),
    });
    manager.register({ manifest: cursorManifest, adapter });

    await expect(manager.health("cursor")).resolves.toEqual({
      manifest: cursorManifest,
      health,
      checkedAt: "2026-07-23T12:30:00.000Z",
    });
    expect(detect).toHaveBeenCalledOnce();
  });

  it("rejects duplicate plugins instead of silently replacing a runtime", () => {
    const manager = new RuntimeManager();
    const adapter = { kind: "cursor" } as unknown as RuntimeAdapter;
    manager.register({ manifest: cursorManifest, adapter });

    expect(() =>
      manager.register({ manifest: cursorManifest, adapter }),
    ).toThrow(/already registered/i);
  });
});
