import { describe, expect, it } from "vitest";
import { redactAuditValue } from "./redaction";

describe("redactAuditValue", () => {
  it("redacts sensitive keys and credential strings recursively", () => {
    const input = {
      token: "sk-secret",
      decision: "allow_once",
      nested: {
        private_key: "-----BEGIN PRIVATE KEY-----",
        messages: [
          "Bearer super-secret-value",
          "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
          "api-key: client-secret",
        ],
      },
    };

    expect(redactAuditValue(input)).toEqual({
      token: "[REDACTED]",
      decision: "allow_once",
      nested: {
        private_key: "[REDACTED]",
        messages: ["[REDACTED]", "[REDACTED]", "[REDACTED]"],
      },
    });
  });

  it("redacts configured filesystem paths without mutating the input", () => {
    const input = {
      resource: "/Users/marcos/.config/service/config.json",
      message: "Read /Users/marcos/.config/service/config.json successfully",
      decision: "allow_once",
    };

    const output = redactAuditValue(input, {
      filesystemPaths: ["/Users/marcos/.config/service/config.json"],
    });

    expect(output).toEqual({
      resource: "[REDACTED]",
      message: "Read [REDACTED] successfully",
      decision: "allow_once",
    });
    expect(input).toEqual({
      resource: "/Users/marcos/.config/service/config.json",
      message: "Read /Users/marcos/.config/service/config.json successfully",
      decision: "allow_once",
    });
  });
});
