import { z } from "zod";

export const runtimeKindSchema = z.enum(["claude", "codex"]);
export const providerKindSchema = z.enum(["claude_max", "chatgpt"]);
export const laneStatusSchema = z.enum([
  "ready",
  "running",
  "waiting_approval",
  "interrupted",
  "failed",
  "closed",
]);

export type RuntimeKind = z.infer<typeof runtimeKindSchema>;
export type LaneStatus = z.infer<typeof laneStatusSchema>;
