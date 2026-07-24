import { z } from "zod";

export const runtimeTransportKindSchema = z.enum([
  "oauth",
  "api",
  "cli",
  "acp",
  "embedded",
]);

export const runtimeAuthenticationSchema = z.enum([
  "okami_oauth",
  "okami_vault",
  "external_cli",
  "browser_subscription",
  "provider_managed",
  "api_key",
]);

export const runtimeEntitlementSchema = z.enum([
  "subscription",
  "token_plan",
  "provider_managed",
  "payg",
]);

export const runtimeCapabilitySchema = z.enum([
  "sessions",
  "streaming",
  "tools",
  "approvals",
  "models",
  "usage",
  "context",
  "subagents",
]);

export const runtimeTransportSchema = z.object({
  id: z.string().min(1),
  kind: runtimeTransportKindSchema,
  authentication: runtimeAuthenticationSchema,
  entitlement: runtimeEntitlementSchema,
  priority: z.number().int().nonnegative(),
  optional: z.boolean(),
  protocolVersion: z.string().min(1),
  executable: z.string().min(1).nullable(),
  legacySessionOwner: z.boolean().optional(),
});

export const runtimeManifestSchema = z.object({
  schemaVersion: z.literal(2),
  runtimeId: z.string().min(1),
  displayName: z.string().min(1),
  providerId: z.string().min(1),
  capabilities: z.array(runtimeCapabilitySchema),
  transports: z.array(runtimeTransportSchema).min(1),
});

export type RuntimeTransport = z.infer<typeof runtimeTransportSchema>;
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export const builtInRuntimeManifests = {
  claude: {
    schemaVersion: 2,
    runtimeId: "claude",
    displayName: "Claude",
    providerId: "anthropic",
    capabilities: ["sessions", "streaming", "tools", "approvals", "usage"],
    transports: [
      {
        id: "claude-cli",
        kind: "cli",
        authentication: "external_cli",
        entitlement: "subscription",
        priority: 100,
        optional: true,
        protocolVersion: "stream-json",
        executable: "claude",
        legacySessionOwner: true,
      },
    ],
  },
  codex: {
    schemaVersion: 2,
    runtimeId: "codex",
    displayName: "Codex",
    providerId: "openai",
    capabilities: [
      "sessions",
      "streaming",
      "tools",
      "approvals",
      "usage",
      "context",
    ],
    transports: [
      {
        id: "codex-managed",
        kind: "embedded",
        authentication: "provider_managed",
        entitlement: "subscription",
        priority: 10,
        optional: false,
        protocolVersion: "app-server-jsonl",
        executable: "@openai/codex",
        legacySessionOwner: true,
      },
    ],
  },
  cursor: {
    schemaVersion: 2,
    runtimeId: "cursor",
    displayName: "Cursor",
    providerId: "cursor",
    capabilities: ["sessions", "streaming", "tools", "models", "usage"],
    transports: [
      {
        id: "cursor-agent",
        kind: "cli",
        authentication: "browser_subscription",
        entitlement: "subscription",
        priority: 100,
        optional: true,
        protocolVersion: "stream-json",
        executable: "cursor-agent",
        legacySessionOwner: true,
      },
    ],
  },
  agy: {
    schemaVersion: 2,
    runtimeId: "agy",
    displayName: "Antigravity",
    providerId: "google-antigravity",
    capabilities: ["sessions", "streaming", "tools", "approvals", "usage"],
    transports: [
      {
        id: "agy-cli",
        kind: "cli",
        authentication: "browser_subscription",
        entitlement: "subscription",
        priority: 100,
        optional: true,
        protocolVersion: "companion-hook",
        executable: "agy",
        legacySessionOwner: true,
      },
    ],
  },
  grok: {
    schemaVersion: 2,
    runtimeId: "grok",
    displayName: "Grok",
    providerId: "xai",
    capabilities: ["sessions", "streaming", "tools", "usage", "context"],
    transports: [
      {
        id: "grok-managed",
        kind: "embedded",
        authentication: "provider_managed",
        entitlement: "subscription",
        priority: 10,
        optional: false,
        protocolVersion: "stream-json",
        executable: "@xai-official/grok",
        legacySessionOwner: true,
      },
    ],
  },
  mimo: {
    schemaVersion: 2,
    runtimeId: "mimo",
    displayName: "MiMo",
    providerId: "xiaomi",
    capabilities: ["sessions", "streaming", "tools", "usage"],
    transports: [
      {
        id: "mimo-token-plan",
        kind: "api",
        authentication: "okami_vault",
        entitlement: "token_plan",
        priority: 10,
        optional: true,
        protocolVersion: "responses-v1",
        executable: null,
        legacySessionOwner: true,
      },
    ],
  },
  minimax: {
    schemaVersion: 2,
    runtimeId: "minimax",
    displayName: "MiniMax",
    providerId: "minimax",
    capabilities: ["sessions", "streaming", "usage", "context"],
    transports: [
      {
        id: "minimax-token-plan",
        kind: "api",
        authentication: "okami_vault",
        entitlement: "token_plan",
        priority: 10,
        optional: true,
        protocolVersion: "chat-completions-v1",
        executable: null,
        legacySessionOwner: true,
      },
    ],
  },
  opencode: {
    schemaVersion: 2,
    runtimeId: "opencode",
    displayName: "OpenCode",
    providerId: "multi-provider",
    capabilities: [
      "sessions",
      "streaming",
      "tools",
      "approvals",
      "models",
      "context",
    ],
    transports: [
      {
        id: "opencode-acp",
        kind: "acp",
        authentication: "provider_managed",
        entitlement: "provider_managed",
        priority: 100,
        optional: true,
        protocolVersion: "acp-0.21",
        executable: "opencode",
        legacySessionOwner: true,
      },
    ],
  },
} as const satisfies Record<string, RuntimeManifest>;
