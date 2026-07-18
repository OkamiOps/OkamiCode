import { describe, expect, it } from "vitest";
import { createGatewayHealthChecker } from "./health";
import { createGatewayProfile } from "./profile";

const profile = createGatewayProfile({
  id: "chatgpt-health",
  provider: "chatgpt",
  kind: "bridged",
  env: {},
  displayQuotaAccount: "ChatGPT Plus",
});

describe("GatewayHealthChecker", () => {
  it("uses a zero-turn handshake once per profile within the TTL", async () => {
    let now = 1_000;
    let handshakes = 0;
    const health = createGatewayHealthChecker({
      ttlMs: 500,
      now: () => now,
      handshake: async (candidate) => {
        expect(candidate.id).toBe(profile.id);
        handshakes += 1;
      },
    });

    expect(await health.check(profile)).toMatchObject({ status: "healthy" });
    expect(await health.check(profile)).toMatchObject({ status: "healthy" });
    expect(handshakes).toBe(1);

    now += 501;
    expect(await health.check(profile)).toMatchObject({ status: "healthy" });
    expect(handshakes).toBe(2);
  });

  it("caches an unhealthy bridge result with a safe reason", async () => {
    let handshakes = 0;
    const health = createGatewayHealthChecker({
      ttlMs: 500,
      now: () => 1_000,
      handshake: () => {
        handshakes += 1;
        throw new Error("refresh token secret must not leak");
      },
    });

    const first = await health.check(profile);
    const second = await health.check(profile);
    expect(first).toMatchObject({
      status: "unhealthy",
      reason: "bridge_unhealthy",
    });
    expect(JSON.stringify(first)).not.toContain("refresh token secret");
    expect(second).toEqual(first);
    expect(handshakes).toBe(1);
  });
});
