import { describe, expect, it } from "vitest";
import { runtimeManifestSchema } from "./manifest";

describe("Okami runtime manifest", () => {
  it("keeps provider, model driver, account and authentication as separate concerns", () => {
    const manifest = runtimeManifestSchema.parse({
      schemaVersion: 1,
      runtimeId: "opencode",
      displayName: "OpenCode",
      providerId: "multi-provider",
      driver: "acp",
      authentication: "provider_managed",
      accountStrategy: "provider_selected",
      executable: "opencode",
      protocolVersion: "acp",
      capabilities: ["sessions", "streaming", "tools", "approvals", "models"],
    });

    expect(manifest.runtimeId).not.toBe(manifest.providerId);
    expect(manifest.driver).toBe("acp");
  });

  it("rejects manifests that cannot identify their protocol", () => {
    expect(() =>
      runtimeManifestSchema.parse({
        schemaVersion: 1,
        runtimeId: "broken",
        displayName: "Broken",
        providerId: "broken",
        driver: "acp",
        authentication: "provider_managed",
        accountStrategy: "provider_selected",
        executable: "broken",
        protocolVersion: "",
        capabilities: [],
      }),
    ).toThrow();
  });
});
