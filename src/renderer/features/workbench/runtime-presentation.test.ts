import { describe, expect, it } from "vitest";
import type { WorkbenchLane } from "./api";
import {
  laneDisplayName,
  providerKindForLane,
  runtimeGlyph,
  runtimePresentation,
} from "./runtime-presentation";

const cursorLane = {
  runtimeKind: "cursor",
  providerAccountLabel: "Cursor",
  model: "default",
} as WorkbenchLane;

const agyLane = {
  runtimeKind: "agy",
  providerAccountLabel: "Antigravity",
  model: "default",
} as WorkbenchLane;

const minimaxLane = {
  runtimeKind: "minimax",
  providerAccountLabel: "MiniMax",
  model: "MiniMax M2.7",
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

  it("uses the Antigravity label without presenting it as another provider", () => {
    expect(runtimeGlyph("agy")).toBe("AG");
    expect(runtimePresentation(agyLane)).toEqual({ glyph: "AG", tone: "agy" });
    expect(laneDisplayName(agyLane)).toBe("Antigravity");
  });

  it("keeps MiniMax identity instead of falling through to Claude", () => {
    expect(runtimePresentation(minimaxLane)).toEqual({
      glyph: "MM",
      tone: "minimax",
    });
    expect(laneDisplayName(minimaxLane)).toBe("MiniMax");
  });

  it("maps the selected lane to the subscription provider shown in quota", () => {
    expect(providerKindForLane(cursorLane)).toBe("cursor");
    expect(providerKindForLane(agyLane)).toBe("antigravity");
    expect(
      providerKindForLane({
        runtimeKind: "claude",
        providerAccountLabel: "ChatGPT",
        model: "gpt-5.6-sol",
      } as WorkbenchLane),
    ).toBe("chatgpt");
    expect(
      providerKindForLane({
        runtimeKind: "claude",
        providerAccountLabel: "Claude Max",
        model: "sonnet",
      } as WorkbenchLane),
    ).toBe("claude_max");
  });
});
