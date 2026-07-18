import { describe, expect, it } from "vitest";
import { createPolicyHarness } from "./test-harness";

describe("PolicyEngine", () => {
  it("denies out-of-scope and expired leases", () => {
    const h = createPolicyHarness();
    const lease = h.lease("workspace.read", "/repo-a", "2026-07-17T19:00:00Z");
    expect(
      h.authorizeAt(lease, "workspace.read", "/repo-b", "2026-07-17T18:00:00Z"),
    ).toEqual({ decision: "deny", reason: "resource_mismatch" });
    expect(
      h.authorizeAt(lease, "workspace.read", "/repo-a", "2026-07-17T20:00:00Z"),
    ).toEqual({ decision: "deny", reason: "expired" });
  });

  it("makes approvals single-use", () => {
    const h = createPolicyHarness();
    const req = h.pendingApproval("terminal.exec", "git status");
    h.resolve(req.id, "allow_once");
    expect(() => h.resolve(req.id, "allow_once")).toThrow(/already resolved/i);
  });
});
