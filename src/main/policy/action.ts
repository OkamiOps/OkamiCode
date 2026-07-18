export type Actor =
  | { kind: "human"; id: string }
  | { kind: "runtime"; runtime: "claude" | "codex" }
  | { kind: "automation"; id: string };
export type Capability =
  | "workspace.read"
  | "workspace.write"
  | "terminal.exec"
  | "browser.open"
  | "approval.resolve"
  | "memory.read"
  | "audit.export";
export type RiskLevel = "read" | "prepare" | "execute" | "critical";
export type DenyReason =
  | "destructive_outside_workspace"
  | "missing_lease"
  | "expired"
  | "actor_mismatch"
  | "task_mismatch"
  | "lane_mismatch"
  | "capability_mismatch"
  | "resource_mismatch"
  | "budget_exceeded";
export type AuthorizationDecision =
  | { decision: "allow"; leaseId: string }
  | { decision: "ask"; approvalId: string }
  | { decision: "deny"; reason: DenyReason };
