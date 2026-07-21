import { describe, expect, it } from "vitest";
import { mimoArgs } from "./command";

describe("mimoArgs", () => {
  it("uses the native JSON runner and preserves the subscription session", () => {
    expect(
      mimoArgs({
        prompt: "Revise o projeto",
        cwd: "/workspace",
        model: "xiaomi/mimo-v2.5-pro",
        sessionId: "session-1",
        effort: "high",
      }),
    ).toEqual([
      "run",
      "--format",
      "json",
      "--dir",
      "/workspace",
      "--model",
      "xiaomi/mimo-v2.5-pro",
      "--session",
      "session-1",
      "--variant",
      "high",
      "Revise o projeto",
    ]);
  });
});
