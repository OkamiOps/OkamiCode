import { describe, expect, it } from "vitest";
import {
  senderAddress,
  senderDomain,
  senderIdentityStyle,
  senderHue,
  senderLabel,
} from "./sender-identity";

describe("sender identity", () => {
  it("gives different addresses stable, distinct visual identities", () => {
    expect(senderIdentityStyle("marcos@okamiops.com")).toEqual(
      senderIdentityStyle("MARCOS@okamiops.com"),
    );
    expect(senderIdentityStyle("marcos@okamiops.com")).not.toEqual(
      senderIdentityStyle("contato@okamiops.com"),
    );
    expect(senderIdentityStyle("contato@okamiops.com")).not.toEqual(
      senderIdentityStyle("scarlett@okamiops.com"),
    );
    const hues = [
      senderHue("marcos@okamiops.com"),
      senderHue("contato@okamiops.com"),
      senderHue("scarlett@okamiops.com"),
    ];
    for (let left = 0; left < hues.length; left += 1) {
      for (let right = left + 1; right < hues.length; right += 1) {
        const distance = Math.abs(hues[left]! - hues[right]!);
        expect(Math.min(distance, 360 - distance)).toBeGreaterThanOrEqual(35);
      }
    }
  });

  it("separates a human-readable sender label from its origin", () => {
    expect(senderLabel("Ana Silva <ana@cliente.com>")).toBe("Ana Silva");
    expect(senderAddress("Ana Silva <ana@cliente.com>")).toBe(
      "ana@cliente.com",
    );
    expect(senderDomain("Ana Silva <ana@cliente.com>")).toBe("@cliente.com");
    expect(senderLabel("contato@okamiops.com")).toBe("contato");
  });
});
