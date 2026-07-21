import { describe, expect, it } from "vitest";
import type { WorkbenchLane } from "./api";
import {
  laneDisplayName,
  runtimeGlyph,
  runtimePresentation,
} from "./runtime-presentation";

const cursorLane = {
  runtimeKind: "cursor",
  providerAccountLabel: "Cursor",
  model: "default",
} as WorkbenchLane;

describe("runtime presentation", () => {
  it("never presents Cursor as Claude, ChatGPT or Grok", () => {
    expect(runtimeGlyph("cursor")).toBe("CU");
    expect(runtimePresentation(cursorLane)).toEqual({
      glyph: "CU",
      tone: "cursor",
    });
    expect(laneDisplayName(cursorLane)).toBe("Cursor");
  });
});
