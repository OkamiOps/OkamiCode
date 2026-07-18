import type { GatewayProfile } from "./profile";

export interface GatewayHealthResult {
  profileId: string;
  status: "healthy" | "unhealthy";
  reason?: "bridge_unhealthy";
  checkedAt: number;
  expiresAt: number;
}

export interface GatewayHealthChecker {
  check(profile: GatewayProfile): Promise<GatewayHealthResult>;
  invalidate(profileId?: string): void;
}

export interface GatewayHealthCheckerOptions {
  ttlMs: number;
  handshake(profile: GatewayProfile): Promise<void> | void;
  now?: () => number;
}

export function createGatewayHealthChecker(
  options: GatewayHealthCheckerOptions,
): GatewayHealthChecker {
  if (options.ttlMs <= 0) throw new Error("Health TTL must be positive");
  const now = options.now ?? Date.now;
  const cache = new Map<string, GatewayHealthResult>();
  const pending = new Map<string, Promise<GatewayHealthResult>>();

  return {
    async check(profile) {
      const cached = cache.get(profile.id);
      if (cached && cached.expiresAt > now()) return cached;
      const inFlight = pending.get(profile.id);
      if (inFlight) return inFlight;
      const result = runHandshake(profile, options, now).then((health) => {
        cache.set(profile.id, health);
        pending.delete(profile.id);
        return health;
      });
      pending.set(profile.id, result);
      return result;
    },
    invalidate(profileId) {
      if (profileId) cache.delete(profileId);
      else cache.clear();
    },
  };
}

async function runHandshake(
  profile: GatewayProfile,
  options: GatewayHealthCheckerOptions,
  now: () => number,
): Promise<GatewayHealthResult> {
  const checkedAt = now();
  try {
    await options.handshake(profile);
    return {
      profileId: profile.id,
      status: "healthy",
      checkedAt,
      expiresAt: checkedAt + options.ttlMs,
    };
  } catch {
    return {
      profileId: profile.id,
      status: "unhealthy",
      reason: "bridge_unhealthy",
      checkedAt,
      expiresAt: checkedAt + options.ttlMs,
    };
  }
}
