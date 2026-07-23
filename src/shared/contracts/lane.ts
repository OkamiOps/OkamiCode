import { z } from "zod";

export const runtimeKindSchema = z.enum([
  "claude",
  "codex",
  "cursor",
  "agy",
  "grok",
  "mimo",
  "minimax",
  "opencode",
]);
export const catalogRuntimeKindSchema = runtimeKindSchema;
export const providerKindSchema = z.enum([
  "claude_max",
  "chatgpt",
  "cursor",
  "antigravity",
  "grok",
  "mimo",
  "minimax",
  "multi_provider",
]);
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
export type CatalogRuntimeKind = z.infer<typeof catalogRuntimeKindSchema>;
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
const grokPermissionModes: readonly PermissionMode[] = [
  "manual",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];
const mimoPermissionModes: readonly PermissionMode[] = ["manual"];
const opencodePermissionModes: readonly PermissionMode[] = [
  "manual",
  "acceptEdits",
  "plan",
];

export function permissionModesForRuntime(
  runtime: RuntimeKind,
): readonly PermissionMode[] {
  if (runtime === "cursor") return cursorPermissionModes;
  if (runtime === "agy") return agyPermissionModes;
  if (runtime === "grok") return grokPermissionModes;
  if (runtime === "mimo") return mimoPermissionModes;
  if (runtime === "opencode") return opencodePermissionModes;
  return permissionModes;
}
