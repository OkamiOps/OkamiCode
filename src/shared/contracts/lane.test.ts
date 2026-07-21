import { describe, expect, it } from "vitest";
import { permissionModesForRuntime } from "./lane";

describe("permission modes by runtime", () => {
  it("exposes only the modes the Cursor adapter can execute safely", () => {
    expect(permissionModesForRuntime("cursor")).toEqual([
      "manual",
      "plan",
      "auto",
    ]);
  });

  it("preserves the existing Claude and Codex modes", () => {
    for (const runtime of ["claude", "codex"] as const) {
      expect(permissionModesForRuntime(runtime)).toEqual([
        "manual",
        "acceptEdits",
        "plan",
        "auto",
        "bypassPermissions",
      ]);
    }
  });

  it("limits AGY to the modes its native turn adapter supports safely", () => {
    expect(permissionModesForRuntime("agy")).toEqual([
      "manual",
      "acceptEdits",
      "plan",
    ]);
  });
});
