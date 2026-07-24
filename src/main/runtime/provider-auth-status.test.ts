import { describe, expect, it } from "vitest";
import {
  parseProviderAuthProbe,
  type ProviderAuthProbe,
} from "./provider-auth-status";

describe("parseProviderAuthProbe", () => {
  const probe = (
    stdout: string,
    stderr = "",
    exitCode = 0,
  ): ProviderAuthProbe => ({ stdout, stderr, exitCode });

  it("extracts the account from official Claude and Cursor status output", () => {
    expect(
      parseProviderAuthProbe(
        "claude",
        probe(
          '{"loggedIn":true,"email":"marcos@example.com","subscriptionType":"max"}',
        ),
      ),
    ).toMatchObject({
      status: "connected",
      accountLabel: "marcos@example.com",
    });
    expect(
      parseProviderAuthProbe(
        "cursor",
        probe("✓ Logged in as marcos@example.com"),
      ),
    ).toMatchObject({
      status: "connected",
      accountLabel: "marcos@example.com",
    });
  });

  it("does not confuse an available motor with an authenticated account", () => {
    expect(
      parseProviderAuthProbe(
        "agy",
        probe("", "You are not logged into Antigravity.", 1),
      ),
    ).toMatchObject({
      status: "not_connected",
      accountLabel: null,
    });
  });

  it("recognizes the successful Antigravity keyring handoff after startup noise", () => {
    expect(
      parseProviderAuthProbe(
        "agy",
        probe(
          "gemini-3.6-flash-low",
          "You are not logged into Antigravity.\nOAuth: authenticated successfully as marcos@example.com",
        ),
      ),
    ).toMatchObject({
      status: "connected",
      accountLabel: "marcos@example.com",
    });
  });
});
