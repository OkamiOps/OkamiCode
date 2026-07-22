import { describe, expect, it } from "vitest";
import {
  modelOptions,
  providerOptions,
  realWorkspaceLanes,
  resolveLane,
  workspaceOptions,
  type SelectableLane,
} from "./lane-selection";

describe("lane selection catalog", () => {
  const lanes: SelectableLane[] = [
    lane("claude", "Claude Max", "opus[1m]", "/Users/marcos/OkamiCode"),
    lane("claude", "Claude Max", "opus[1m]", "/Users/marcos/OkamiCode"),
    lane("agy", "Antigravity", "gemini-3.6-flash", "/Users/marcos/OkamiCode"),
    lane(
      "agy",
      "Antigravity",
      "gemini-3.6-flash",
      "/var/folders/x/T/okami-inbox-analysis-deadbeef",
    ),
  ];

  it("removes temporary inbox lanes and deduplicates provider, model and workspace", () => {
    const eligible = realWorkspaceLanes(lanes);
    expect(eligible).toHaveLength(3);
    expect(providerOptions(eligible)).toHaveLength(2);
    expect(modelOptions(eligible, "claude:Claude Max")).toEqual([
      { id: "opus[1m]", label: "opus[1m]" },
    ]);
    expect(workspaceOptions(eligible, "claude:Claude Max", "opus[1m]")).toEqual(
      [
        {
          id: "/Users/marcos/OkamiCode",
          label: "OkamiCode · /Users/marcos/OkamiCode",
        },
      ],
    );
  });

  it("resolves the final lane only after the three explicit choices", () => {
    expect(
      resolveLane(
        realWorkspaceLanes(lanes),
        "agy:Antigravity",
        "gemini-3.6-flash",
        "/Users/marcos/OkamiCode",
      )?.runtimeKind,
    ).toBe("agy");
  });
});

function lane(
  runtimeKind: string,
  providerAccountLabel: string,
  model: string,
  workspacePath: string,
): SelectableLane {
  return {
    laneId: crypto.randomUUID(),
    model,
    providerAccountLabel,
    runtimeKind,
    workspacePath,
  };
}
