import { describe, expect, it } from "vitest";
import { parseDeviceAuthChallenge } from "./subscription-device-auth";

describe("parseDeviceAuthChallenge", () => {
  it("parses the official Codex device connection output", () => {
    expect(
      parseDeviceAuthChallenge(
        "codex",
        "Open https://auth.openai.com/codex/device and enter ABCD-EFGH",
      ),
    ).toEqual({
      provider: "codex",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
    });
  });

  it("parses the official Grok device connection shape", () => {
    expect(
      parseDeviceAuthChallenge(
        "grok",
        "Continue at https://auth.x.ai/device\nCode: WXYZ-1234",
      ),
    ).toEqual({
      provider: "grok",
      verificationUrl: "https://auth.x.ai/device",
      userCode: "WXYZ-1234",
    });
  });

  it("does not accept arbitrary text as a device challenge", () => {
    expect(parseDeviceAuthChallenge("codex", "login failed")).toBeNull();
  });
});
