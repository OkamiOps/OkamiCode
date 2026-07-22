import { describe, expect, it } from "vitest";
import { parsePorcelainStatus } from "./git-worktree";

describe("parsePorcelainStatus", () => {
  it("classifies staged, working-tree and untracked changes without losing renames", () => {
    const status = [
      " M src/changed.ts",
      "A  src/created.ts",
      "?? src/new.ts",
      "R  src/new-name.ts",
      "src/old-name.ts",
      "",
    ].join("\0");

    expect(parsePorcelainStatus(status)).toEqual([
      {
        path: "src/changed.ts",
        previousPath: null,
        status: "modified",
        staged: false,
        unstaged: true,
      },
      {
        path: "src/created.ts",
        previousPath: null,
        status: "added",
        staged: true,
        unstaged: false,
      },
      {
        path: "src/new.ts",
        previousPath: null,
        status: "untracked",
        staged: false,
        unstaged: true,
      },
      {
        path: "src/new-name.ts",
        previousPath: "src/old-name.ts",
        status: "renamed",
        staged: true,
        unstaged: false,
      },
    ]);
  });

  it("marks unresolved merge states as conflicts", () => {
    expect(parsePorcelainStatus("UU src/conflict.ts\0")).toEqual([
      expect.objectContaining({
        path: "src/conflict.ts",
        status: "conflicted",
        staged: true,
        unstaged: true,
      }),
    ]);
  });
});
