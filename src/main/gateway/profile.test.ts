import { describe, expect, it } from "vitest";
import { createGatewayProfile } from "./profile";

describe("createGatewayProfile", () => {
  it("accepts provider-specific environment without Anthropic credentials", () => {
    expect(
      createGatewayProfile({
        id: "chatgpt-default",
        provider: "chatgpt",
        kind: "bridged",
        env: { CODEX_HOME: "/tmp/okami-codex" },
        displayQuotaAccount: "ChatGPT Plus",
      }),
    ).toMatchObject({ provider: "chatgpt", kind: "bridged" });
  });

  it("rejects an Anthropic credential in a non-Claude profile", () => {
    expect(() =>
      createGatewayProfile({
        id: "chatgpt-invalid",
        provider: "chatgpt",
        kind: "bridged",
        env: { ANTHROPIC_API_KEY: "forbidden-fixture-value" },
        displayQuotaAccount: "ChatGPT Plus",
      }),
    ).toThrow(/must not contain Anthropic credentials/);
  });
});
