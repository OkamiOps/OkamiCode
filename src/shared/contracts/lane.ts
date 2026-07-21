import { z } from "zod";

export const runtimeKindSchema = z.enum(["claude", "codex", "cursor", "agy"]);
export const providerKindSchema = z.enum(["claude_max", "chatgpt", "cursor"]);
export const laneStatusSchema = z.enum([
  "ready",
  "running",
  "waiting_approval",
  "interrupted",
  "failed",
  "closed",
]);
export const permissionModes = [
  "manual",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
] as const;

export type RuntimeKind = z.infer<typeof runtimeKindSchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type LaneStatus = z.infer<typeof laneStatusSchema>;
export type PermissionMode = (typeof permissionModes)[number];

const cursorPermissionModes: readonly PermissionMode[] = [
  "manual",
  "plan",
  "auto",
];
const agyPermissionModes: readonly PermissionMode[] = [
  "manual",
  "acceptEdits",
  "plan",
];

export function permissionModesForRuntime(
  runtime: RuntimeKind,
): readonly PermissionMode[] {
  if (runtime === "cursor") return cursorPermissionModes;
  if (runtime === "agy") return agyPermissionModes;
  return permissionModes;
}
