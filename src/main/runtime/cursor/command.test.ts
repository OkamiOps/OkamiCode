import { describe, expect, it } from "vitest";
import { cursorArgs } from "./command";

describe("cursorArgs", () => {
  it("builds a fresh print-mode stream-json turn with the prompt last", () => {
    expect(
      cursorArgs({ prompt: "Inspect this workspace", model: "auto" }),
    ).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      "auto",
      "Inspect this workspace",
    ]);
  });

  it("builds a resumed turn without weakening approval semantics", () => {
    const args = cursorArgs({
      prompt: "Continue",
      resumeId: "<redacted-cursor-session-id>",
    });

    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--resume=<redacted-cursor-session-id>",
      "Continue",
    ]);
    expect(args).not.toContain("--force");
    expect(args.at(-1)).toBe("Continue");
  });
});
