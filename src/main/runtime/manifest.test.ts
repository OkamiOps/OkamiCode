import { describe, expect, it } from "vitest";
import { builtInRuntimeManifests, runtimeManifestSchema } from "./manifest";

describe("Okami runtime manifest", () => {
  it("keeps providers independent from their ordered transports", () => {
    const manifest = runtimeManifestSchema.parse({
      schemaVersion: 2,
      runtimeId: "grok",
      displayName: "Grok",
      providerId: "xai",
      capabilities: ["sessions", "streaming", "tools", "approvals", "models"],
      transports: [
        {
          id: "xai-api",
          kind: "api",
          authentication: "api_key",
          entitlement: "payg",
          priority: 10,
          optional: true,
          protocolVersion: "responses-v1",
          executable: null,
        },
        {
          id: "grok-cli",
          kind: "cli",
          authentication: "external_cli",
          entitlement: "subscription",
          priority: 100,
          optional: true,
          protocolVersion: "stream-json",
          executable: "grok",
          legacySessionOwner: true,
        },
      ],
    });

    expect(manifest.runtimeId).not.toBe(manifest.providerId);
    expect(manifest.transports.map((transport) => transport.kind)).toEqual([
      "api",
      "cli",
    ]);
  });

  it("rejects a provider manifest without a transport", () => {
    expect(() =>
      runtimeManifestSchema.parse({
        schemaVersion: 2,
        runtimeId: "broken",
        displayName: "Broken",
        providerId: "broken",
        capabilities: [],
        transports: [],
      }),
    ).toThrow();
  });

  it("ships no pay-as-you-go transport in the default runtime catalog", () => {
    expect(
      Object.values(builtInRuntimeManifests).flatMap((manifest) =>
        manifest.transports.map((transport) => transport.entitlement),
      ),
    ).not.toContain("payg");
  });

  it("uses managed subscription runtimes and dedicated Token Plan transports", () => {
    expect(builtInRuntimeManifests.codex.transports[0]).toMatchObject({
      id: "codex-managed",
      kind: "embedded",
      authentication: "provider_managed",
      entitlement: "subscription",
    });
    expect(builtInRuntimeManifests.grok.transports[0]).toMatchObject({
      id: "grok-managed",
      kind: "embedded",
      authentication: "provider_managed",
      entitlement: "subscription",
    });
    expect(builtInRuntimeManifests.mimo.transports[0]).toMatchObject({
      id: "mimo-token-plan",
      kind: "api",
      authentication: "okami_vault",
      entitlement: "token_plan",
      executable: null,
      protocolVersion: "responses-v1",
    });
    expect(builtInRuntimeManifests.minimax.transports[0]).toMatchObject({
      id: "minimax-token-plan",
      kind: "api",
      authentication: "okami_vault",
      entitlement: "token_plan",
      executable: null,
      protocolVersion: "chat-completions-v1",
    });
  });

  it("advertises canonical turn usage for every adapter that emits it", () => {
    expect(builtInRuntimeManifests.cursor.capabilities).toContain("usage");
    expect(builtInRuntimeManifests.mimo.capabilities).toContain("usage");
    expect(builtInRuntimeManifests.minimax.capabilities).toContain("usage");
    expect(builtInRuntimeManifests.opencode.capabilities).not.toContain(
      "usage",
    );
    expect(builtInRuntimeManifests.opencode.capabilities).toContain("context");
  });
});
