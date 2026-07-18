export type GatewayProvider = "chatgpt" | "minimax" | "mimo";

export interface GatewayProfile {
  id: string;
  provider: GatewayProvider;
  kind: "bridged" | "compatible";
  env: Record<string, string>;
  displayQuotaAccount: string;
}

export function createGatewayProfile(profile: GatewayProfile): GatewayProfile {
  assertNoAnthropicCredentials(profile);
  return { ...profile, env: { ...profile.env } };
}

export function assertNoAnthropicCredentials(profile: GatewayProfile): void {
  const credential = Object.entries(profile.env).find(
    ([key, value]) =>
      (/anthropic/i.test(key) &&
        /(?:key|token|secret|credential)/i.test(key)) ||
      /sk-ant-/i.test(value),
  );
  if (credential) {
    throw new Error(
      `Gateway profile ${profile.id} must not contain Anthropic credentials`,
    );
  }
}
