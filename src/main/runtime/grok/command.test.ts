import { describe, expect, it } from "vitest";
import { grokArgs } from "./command";

describe("grokArgs", () => {
  it("creates a new native streaming session with model and effort", () => {
    expect(
      grokArgs({
        prompt: "Revise o projeto",
        sessionId: "019f0000-0000-7000-8000-000000000001",
        resume: false,
        model: "grok-build",
        effort: "high",
        permissionMode: "plan",
      }),
    ).toEqual([
      "--single",
      "Revise o projeto",
      "--output-format",
      "streaming-json",
      "--session-id",
      "019f0000-0000-7000-8000-000000000001",
      "--model",
      "grok-build",
      "--reasoning-effort",
      "high",
      "--permission-mode",
      "plan",
    ]);
  });

  it("resumes subsequent turns instead of overwriting the session", () => {
    expect(
      grokArgs({
        prompt: "Continue",
        sessionId: "session-id",
        resume: true,
      }),
    ).toContain("--resume");
    expect(
      grokArgs({ prompt: "x", sessionId: "id", resume: true }),
    ).not.toContain("--session-id");
  });
});
