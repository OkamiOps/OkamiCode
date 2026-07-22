import type { ProviderKind, RuntimeKind } from "../../../shared/contracts/lane";
import type { WorkbenchLane } from "./api";

export type RuntimeGlyph = "CL" | "GP" | "GK" | "CU" | "AG" | "MI" | "MM";

export function runtimeGlyph(runtime: RuntimeKind): RuntimeGlyph {
  if (runtime === "claude") return "CL";
  if (runtime === "codex") return "GP";
  if (runtime === "agy") return "AG";
  if (runtime === "grok") return "GK";
  if (runtime === "mimo") return "MI";
  if (runtime === "minimax") return "MM";
  return "CU";
}

export function runtimePresentation(lane: WorkbenchLane) {
  if (lane.runtimeKind === "cursor") {
    return { glyph: "CU", tone: "cursor" } as const;
  }
  if (lane.runtimeKind === "agy") {
    return { glyph: "AG", tone: "agy" } as const;
  }
  if (lane.runtimeKind === "grok") {
    return { glyph: "GK", tone: "grok" } as const;
  }
  if (lane.runtimeKind === "mimo") {
    return { glyph: "MI", tone: "mimo" } as const;
  }
  if (lane.runtimeKind === "minimax") {
    return { glyph: "MM", tone: "minimax" } as const;
  }
  const account = `${lane.providerAccountLabel} ${lane.model}`.toLowerCase();
  if (account.includes("grok")) return { glyph: "GK", tone: "grok" } as const;
  if (/chatgpt|\bgpt|\bo[134]/u.test(account)) {
    return { glyph: "GP", tone: "gpt" } as const;
  }
  return { glyph: "CL", tone: "claude" } as const;
}

export function providerKindForLane(lane: WorkbenchLane): ProviderKind {
  if (lane.runtimeKind === "cursor") return "cursor";
  if (lane.runtimeKind === "agy") return "antigravity";
  if (lane.runtimeKind === "grok") return "grok";
  if (lane.runtimeKind === "mimo") return "mimo";
  if (lane.runtimeKind === "minimax") return "minimax";
  const account = `${lane.providerAccountLabel} ${lane.model}`.toLowerCase();
  return /chatgpt|\bgpt|\bo[134]/u.test(account) ? "chatgpt" : "claude_max";
}

export function laneDisplayName(lane: WorkbenchLane): string {
  if (lane.runtimeKind === "cursor") return "Cursor";
  if (lane.runtimeKind === "agy") return "Antigravity";
  if (lane.runtimeKind === "grok") return "Grok";
  if (lane.runtimeKind === "mimo") return "MiMo Code";
  if (lane.runtimeKind === "minimax") return "MiniMax";
  return lane.providerAccountLabel === "ChatGPT" ||
    /^gpt|^o[134]/iu.test(lane.model)
    ? "Codex"
    : "Claude";
}
