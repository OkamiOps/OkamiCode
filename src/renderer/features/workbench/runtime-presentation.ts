import type { RuntimeKind } from "../../../shared/contracts/lane";
import type { WorkbenchLane } from "./api";

export type RuntimeGlyph = "CL" | "GP" | "GK" | "CU";

export function runtimeGlyph(runtime: RuntimeKind): RuntimeGlyph {
  if (runtime === "claude") return "CL";
  if (runtime === "codex") return "GP";
  return "CU";
}

export function runtimePresentation(lane: WorkbenchLane) {
  if (lane.runtimeKind === "cursor") {
    return { glyph: "CU", tone: "cursor" } as const;
  }
  const account = `${lane.providerAccountLabel} ${lane.model}`.toLowerCase();
  if (account.includes("grok")) return { glyph: "GK", tone: "grok" } as const;
  if (/chatgpt|\bgpt|\bo[134]/u.test(account)) {
    return { glyph: "GP", tone: "gpt" } as const;
  }
  return { glyph: "CL", tone: "claude" } as const;
}

export function laneDisplayName(lane: WorkbenchLane): string {
  if (lane.runtimeKind === "cursor") return "Cursor";
  return lane.providerAccountLabel === "ChatGPT" ||
    /^gpt|^o[134]/iu.test(lane.model)
    ? "Codex"
    : "Claude";
}
