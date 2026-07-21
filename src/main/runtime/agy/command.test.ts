import { describe, expect, it } from "vitest";
import { agyLauncherArgs, agyTurnArgs } from "./command";

describe("agyLauncherArgs", () => {
  it("builds a workspace-bound launcher command without a prompt or print mode", () => {
    const args = agyLauncherArgs({
      workspacePath: "/Users/marcos/Workspace",
      model: "gemini-2.5-pro",
      agent: "planner",
    });

    expect(args).toEqual([
      "--add-dir",
      "/Users/marcos/Workspace",
      "--sandbox",
      "--model",
      "gemini-2.5-pro",
      "--agent",
      "planner",
    ]);
    expect(args).not.toContain("--print");
    expect(args).not.toContain("--prompt");
  });

  it("resumes only the explicitly selected native conversation", () => {
    expect(
      agyLauncherArgs({
        workspacePath: "/Users/marcos/Workspace",
        conversationId: "<redacted-agy-conversation-id>",
        permissionMode: "plan",
      }),
    ).toEqual([
      "--add-dir",
      "/Users/marcos/Workspace",
      "--mode",
      "plan",
      "--sandbox",
      "--conversation",
      "<redacted-agy-conversation-id>",
    ]);
  });

  it("maps accept-edits without weakening permissions", () => {
    const args = agyLauncherArgs({
      workspacePath: "/Users/marcos/Workspace",
      permissionMode: "acceptEdits",
    });

    expect(args).toEqual([
      "--add-dir",
      "/Users/marcos/Workspace",
      "--mode",
      "accept-edits",
      "--sandbox",
    ]);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it.each(["auto", "bypassPermissions"])(
    "rejects unsupported permission mode %s before spawning AGY",
    (permissionMode) => {
      expect(() =>
        agyLauncherArgs({
          workspacePath: "/Users/marcos/Workspace",
          permissionMode,
        }),
      ).toThrow(
        `AGY does not safely support permission mode ${permissionMode}`,
      );
    },
  );

  it("rejects a relative workspace before it can escape the lane boundary", () => {
    expect(() =>
      agyLauncherArgs({ workspacePath: "relative/workspace" }),
    ).toThrow("AGY workspace must be an absolute path");
  });
});

describe("agyTurnArgs", () => {
  it("adds print mode and the prompt while preserving the safe launcher boundary", () => {
    const args = agyTurnArgs({
      workspacePath: "/Users/marcos/Workspace",
      conversationId: "<redacted-agy-conversation-id>",
      model: "gemini-2.5-pro",
      agent: "planner",
      permissionMode: "acceptEdits",
      prompt: "Inspect the repository.",
    });

    expect(args).toEqual([
      "--add-dir",
      "/Users/marcos/Workspace",
      "--mode",
      "accept-edits",
      "--sandbox",
      "--conversation",
      "<redacted-agy-conversation-id>",
      "--model",
      "gemini-2.5-pro",
      "--agent",
      "planner",
      "--print",
      "Inspect the repository.",
    ]);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it.each(["", "   ", "x".repeat(100_001)])(
    "rejects an empty or oversized prompt before AGY can be invoked",
    (prompt) => {
      expect(() =>
        agyTurnArgs({ workspacePath: "/Users/marcos/Workspace", prompt }),
      ).toThrow(/prompt/i);
    },
  );
});
