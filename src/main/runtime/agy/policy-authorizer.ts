import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { Capability } from "../../policy/action";
import type { ApprovalBroker } from "../codex/adapter";
import type { NativeTurnRequest } from "../adapter";
import type { AgyApprovalRequest, AgyTurnAuthorizer } from "./adapter";

type PolicyAuthorizer = {
  authorize(request: {
    leaseId?: string | null;
    actor: { kind: "runtime"; runtime: "agy" };
    taskId: string;
    laneId: string;
    runId: string;
    capability: Capability;
    resource: string;
    risk: "read" | "prepare" | "execute" | "critical";
    destructive?: boolean;
    outsideWorkspace?: boolean;
    now: string;
  }):
    | { decision: "allow" }
    | { decision: "deny" }
    | { decision: "ask"; approvalId: string };
};

export interface AgyPolicyAuthorizerOptions {
  policyEngine: PolicyAuthorizer;
  approvalBroker: ApprovalBroker;
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => string | Promise<string>;
  leaseIdsForRun: (
    runId: NativeTurnRequest["runId"],
  ) =>
    | Partial<Record<Capability, string>>
    | Promise<Partial<Record<Capability, string>>>;
  workspacePathForLane: (laneId: NativeTurnRequest["laneId"]) => string | null;
  permissionModeForLane: (
    laneId: NativeTurnRequest["laneId"],
  ) => string | undefined;
  now?: () => string;
  approvalTimeoutMs?: number;
  approvalPollMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ToolPolicy {
  capability: Capability;
  risk: "read" | "prepare" | "execute" | "critical";
  pathArgument?: string;
  resourceArgument?: string;
  httpUrl?: boolean;
}

const TOOL_POLICIES: Readonly<Record<string, ToolPolicy>> = {
  view_file: {
    capability: "workspace.read",
    risk: "read",
    pathArgument: "AbsolutePath",
  },
  list_dir: {
    capability: "workspace.read",
    risk: "read",
    pathArgument: "DirectoryPath",
  },
  find_by_name: {
    capability: "workspace.read",
    risk: "read",
    pathArgument: "SearchDirectory",
  },
  grep_search: {
    capability: "workspace.read",
    risk: "read",
    pathArgument: "SearchPath",
  },
  write_to_file: {
    capability: "workspace.write",
    risk: "critical",
    pathArgument: "TargetFile",
  },
  replace_file_content: {
    capability: "workspace.write",
    risk: "critical",
    pathArgument: "TargetFile",
  },
  multi_replace_file_content: {
    capability: "workspace.write",
    risk: "critical",
    pathArgument: "TargetFile",
  },
  run_command: { capability: "terminal.exec", risk: "critical" },
  search_web: {
    capability: "browser.open",
    risk: "read",
    resourceArgument: "query",
  },
  read_url_content: {
    capability: "browser.open",
    risk: "read",
    resourceArgument: "Url",
    httpUrl: true,
  },
};

/**
 * Translates the documented AGY PreToolUse names and argument shape into
 * Okami leases. Unknown tools and ambiguous resources intentionally deny.
 */
export function createAgyPolicyAuthorizer(
  options: AgyPolicyAuthorizerOptions,
): Pick<AgyTurnAuthorizer, "authorize" | "completeRun"> {
  const now = options.now ?? (() => new Date().toISOString());
  const approvalTimeoutMs = Math.min(
    options.approvalTimeoutMs ?? 20_000,
    24_000,
  );
  const approvalPollMs = Math.max(1, options.approvalPollMs ?? 100);
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const leasesByRun = new Map<
    NativeTurnRequest["runId"],
    Promise<Partial<Record<Capability, string>>>
  >();

  return {
    async authorize(context) {
      if (context.hook.hookName !== "PreToolUse") return "deny";
      const policy = TOOL_POLICIES[context.hook.toolCall.name];
      if (!policy) return "deny";

      const workspace = options.workspacePathForLane(context.laneId);
      if (
        !workspace ||
        !workspaceMatchesHook(workspace, context.hook.workspacePaths)
      ) {
        return "deny";
      }
      if (
        options.permissionModeForLane(context.laneId) === "plan" &&
        policy.capability !== "workspace.read" &&
        policy.capability !== "browser.open"
      ) {
        return "deny";
      }

      const resource = await resourceForTool(
        policy,
        context.hook.toolCall.args,
        workspace,
      );
      if (!resource) return "deny";
      const leaseIds =
        leasesByRun.get(context.runId) ??
        Promise.resolve(options.leaseIdsForRun(context.runId));
      leasesByRun.set(context.runId, leaseIds);
      const [taskId, leases] = await Promise.all([
        options.taskIdForRun(context.runId),
        leaseIds,
      ]);
      const decision = options.policyEngine.authorize({
        leaseId: leases[policy.capability],
        actor: { kind: "runtime", runtime: "agy" },
        taskId,
        laneId: context.laneId,
        runId: context.runId,
        capability: policy.capability,
        resource,
        risk: policy.risk,
        destructive: policy.capability === "workspace.write",
        outsideWorkspace: false,
        now: now(),
      });
      if (decision.decision === "allow") return "allow";
      if (decision.decision === "deny") return "deny";
      const approval: AgyApprovalRequest = {
        approvalId: decision.approvalId,
        capability: policy.capability,
        resource,
        risk: policy.risk,
      };
      if (!context.onApprovalRequested?.(approval)) return "deny";
      return waitForApproval(
        options.approvalBroker,
        decision.approvalId,
        approvalTimeoutMs,
        approvalPollMs,
        sleep,
      );
    },
    completeRun(runId) {
      leasesByRun.delete(runId);
    },
  };
}

async function resourceForTool(
  policy: ToolPolicy,
  args: Record<string, unknown>,
  workspace: string,
): Promise<string | null> {
  if (policy.resourceArgument) {
    const value = args[policy.resourceArgument];
    if (typeof value !== "string" || value.trim().length === 0) return null;
    return policy.httpUrl && !/^https?:\/\//iu.test(value) ? null : value;
  }
  if (!policy.pathArgument) {
    const command = args.CommandLine;
    const cwd = args.Cwd;
    if (typeof command !== "string" || command.trim().length === 0) return null;
    if (!(await workspacePath(cwd, workspace, false))) return null;
    return command;
  }
  return workspacePath(
    args[policy.pathArgument],
    workspace,
    policy.capability === "workspace.write",
  );
}

async function workspacePath(
  value: unknown,
  workspace: string,
  allowMissingTarget: boolean,
): Promise<string | null> {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    !path.isAbsolute(value)
  ) {
    return null;
  }
  const declaredWorkspace = path.resolve(workspace);
  const declaredTarget = path.resolve(value);
  if (!isWithin(declaredTarget, declaredWorkspace)) return null;
  let resolvedWorkspace: string;
  try {
    resolvedWorkspace = await realpath(declaredWorkspace);
  } catch {
    return null;
  }
  const resolvedTarget = await realTargetOrAncestor(
    declaredTarget,
    allowMissingTarget,
  );
  return resolvedTarget && isWithin(resolvedTarget, resolvedWorkspace)
    ? declaredTarget
    : null;
}

async function realTargetOrAncestor(
  target: string,
  allowMissingTarget: boolean,
): Promise<string | null> {
  for (let candidate = target; ; candidate = path.dirname(candidate)) {
    try {
      return await realpath(candidate);
    } catch {
      try {
        if ((await lstat(candidate)).isSymbolicLink()) return null;
      } catch {
        // A missing path is expected only for a pending write target.
        if (allowMissingTarget && candidate !== path.dirname(candidate)) {
          continue;
        }
      }
      // An existing non-symlink that cannot be resolved is ambiguous too.
      return null;
    }
  }
}

function isWithin(target: string, workspace: string): boolean {
  return target === workspace || target.startsWith(`${workspace}${path.sep}`);
}

function workspaceMatchesHook(
  workspace: string,
  paths: readonly string[],
): boolean {
  const resolved = path.resolve(workspace);
  return paths.some((candidate) => path.resolve(candidate) === resolved);
}

async function waitForApproval(
  broker: ApprovalBroker,
  approvalId: string,
  timeoutMs: number,
  pollMs: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<"allow" | "deny"> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollMs));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const decision = await broker.resolvedDecision(approvalId);
    if (decision === "allow_once") return "allow";
    if (decision === "deny") return "deny";
    if (attempt + 1 < attempts) await sleep(pollMs);
  }
  return "deny";
}
