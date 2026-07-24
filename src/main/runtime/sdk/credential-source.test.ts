import { describe, expect, it } from "vitest";
import { EnvironmentCredentialSource } from "./credential-source";

describe("EnvironmentCredentialSource", () => {
  it("returns a trimmed credential without exposing it in diagnostics", async () => {
    const source = new EnvironmentCredentialSource("XAI_API_KEY", {
      XAI_API_KEY: "  secret-value  ",
    });

    await expect(source.get()).resolves.toBe("secret-value");
    expect(source.describe()).toEqual({
      available: true,
      source: "environment",
      reference: "XAI_API_KEY",
    });
    expect(JSON.stringify(source.describe())).not.toContain("secret-value");
  });

  it("reports a missing credential honestly", async () => {
    const source = new EnvironmentCredentialSource("OPENAI_API_KEY", {});

    await expect(source.get()).resolves.toBeNull();
    expect(source.describe()).toMatchObject({
      available: false,
      reference: "OPENAI_API_KEY",
    });
  });
});
