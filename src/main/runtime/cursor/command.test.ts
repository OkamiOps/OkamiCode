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
      "--stream-partial-output",
      "--sandbox",
      "enabled",
      "--trust",
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
      "--stream-partial-output",
      "--sandbox",
      "enabled",
      "--trust",
      "--resume=<redacted-cursor-session-id>",
      "Continue",
    ]);
    expect(args).not.toContain("--force");
    expect(args.at(-1)).toBe("Continue");
  });

  it("maps only permission modes with a safe Cursor equivalent", () => {
    expect(cursorArgs({ prompt: "Plan", permissionMode: "plan" })).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--mode",
      "plan",
      "--sandbox",
      "enabled",
      "--trust",
      "Plan",
    ]);
    expect(cursorArgs({ prompt: "Auto", permissionMode: "auto" })).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--auto-review",
      "--sandbox",
      "enabled",
      "--trust",
      "Auto",
    ]);
    expect(() =>
      cursorArgs({ prompt: "Unsafe", permissionMode: "acceptEdits" }),
    ).toThrow("Cursor does not safely support permission mode acceptEdits");
    expect(() =>
      cursorArgs({ prompt: "Unsafe", permissionMode: "bypassPermissions" }),
    ).toThrow(
      "Cursor does not safely support permission mode bypassPermissions",
    );
  });

  it("omits the integration sentinel model default", () => {
    const args = cursorArgs({ prompt: "Inspect", model: "default" });

    expect(args).not.toContain("--model");
    expect(args.at(-1)).toBe("Inspect");
  });
});
