import type { RuntimeKind } from "../../shared/contracts/lane";
import type { GatewayProfile, GatewayProvider } from "./profile";
import { assertNoAnthropicCredentials } from "./profile";

export type GatewayHealthStatus = "healthy" | "unhealthy" | "unknown";

export interface GatewayAccount {
  provider: GatewayProvider;
  compatibleProfile?: GatewayProfile;
  bridgedProfile?: GatewayProfile;
  nativeRuntime?: RuntimeKind;
}

export interface ResolveRouteOptions {
  model: string;
  accounts: GatewayAccount[];
  health?: Partial<Record<string, GatewayHealthStatus>>;
  preferNative?: boolean;
}

export type ResolvedRoute =
  | {
      harness: "claude";
      kind: "direct";
      runtime: "claude";
      reason: "claude_model";
      displayQuotaAccount: string;
    }
  | {
      harness: "claude";
      kind: "compatible" | "bridged";
      profile: GatewayProfile;
      reason: "official_compatible" | "subscription_bridge";
      displayQuotaAccount: string;
    }
  | {
      harness: "native";
      kind: "native";
      runtime: RuntimeKind;
      reason: "native_requested" | "compatible_unhealthy" | "bridge_unhealthy";
      displayQuotaAccount: string;
    }
  | {
      harness: "native";
      kind: "unavailable";
      reason: "account_unavailable" | "route_unavailable";
      displayQuotaAccount: string;
    };

export function resolveRoute(options: ResolveRouteOptions): ResolvedRoute {
  if (isClaudeModel(options.model)) {
    return {
      harness: "claude",
      kind: "direct",
      runtime: "claude",
      reason: "claude_model",
      displayQuotaAccount: "Claude subscription",
    };
  }

  const provider = providerForModel(options.model);
  const account = options.accounts.find(
    (candidate) => candidate.provider === provider,
  );
  if (!account) {
    return {
      harness: "native",
      kind: "unavailable",
      reason: "account_unavailable",
      displayQuotaAccount: provider ?? "Unknown provider",
    };
  }

  const displayQuotaAccount =
    account.compatibleProfile?.displayQuotaAccount ??
    account.bridgedProfile?.displayQuotaAccount ??
    account.provider;
  if (options.preferNative && account.nativeRuntime) {
    return {
      harness: "native",
      kind: "native",
      runtime: account.nativeRuntime,
      reason: "native_requested",
      displayQuotaAccount,
    };
  }

  const compatible = account.compatibleProfile;
  if (compatible && isUsable(compatible, options.health)) {
    assertNoAnthropicCredentials(compatible);
    return {
      harness: "claude",
      kind: "compatible",
      profile: compatible,
      reason: "official_compatible",
      displayQuotaAccount: compatible.displayQuotaAccount,
    };
  }

  const bridged = account.bridgedProfile;
  if (bridged && isUsable(bridged, options.health)) {
    assertNoAnthropicCredentials(bridged);
    return {
      harness: "claude",
      kind: "bridged",
      profile: bridged,
      reason: "subscription_bridge",
      displayQuotaAccount: bridged.displayQuotaAccount,
    };
  }

  if (account.nativeRuntime) {
    return {
      harness: "native",
      kind: "native",
      runtime: account.nativeRuntime,
      reason: bridged ? "bridge_unhealthy" : "compatible_unhealthy",
      displayQuotaAccount,
    };
  }
  return {
    harness: "native",
    kind: "unavailable",
    reason: "route_unavailable",
    displayQuotaAccount,
  };
}

// The Claude CLI accepts these aliases without the "claude-" prefix.
const CLAUDE_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku", "opusplan"]);

function isClaudeModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes("claude") || CLAUDE_MODEL_ALIASES.has(normalized);
}

function providerForModel(model: string): GatewayProvider | undefined {
  const normalized = model.toLowerCase();
  if (/^(?:gpt|o[134])/.test(normalized) || normalized.includes("chatgpt")) {
    return "chatgpt";
  }
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("mimo")) return "mimo";
  return undefined;
}

function isUsable(
  profile: GatewayProfile,
  health: ResolveRouteOptions["health"],
): boolean {
  return (
    health?.[profile.id] !== "unhealthy" &&
    health?.[profile.provider] !== "unhealthy"
  );
}
