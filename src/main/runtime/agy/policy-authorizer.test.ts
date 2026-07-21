import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAgyHook } from "./hook-contract";
import { createAgyPolicyAuthorizer } from "./policy-authorizer";

const runId = "11111111-1111-4111-8111-111111111111" as never;
const laneId = "22222222-2222-4222-8222-222222222222" as never;
let workspace = "";
let outside = "";

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "okami-agy-workspace-"));
  outside = await mkdtemp(path.join(tmpdir(), "okami-agy-outside-"));
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, "src", "main.ts"), "export {};\n");
  await writeFile(path.join(workspace, "a.ts"), "export {};\n");
  await writeFile(path.join(outside, "secret.txt"), "secret\n");
});

afterEach(async () => {
  await Promise.all(
    [workspace, outside]
      .filter(Boolean)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function hook(name: string, args: Record<string, unknown>) {
  return parseAgyHook("PreToolUse", {
    conversationId: "conversation-1",
    workspacePaths: [workspace],
    transcriptPath: `${workspace}/transcript.jsonl`,
    artifactDirectoryPath: `${workspace}/artifacts`,
    stepIdx: 1,
    toolCall: { name, args },
  }) as NonNullable<ReturnType<typeof parseAgyHook>>;
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const policyEngine = {
    authorize: vi.fn(() => ({ decision: "allow" as const })),
  };
  const approvalBroker = {
    resolvedDecision: vi.fn(async () => undefined),
  };
  return {
    policyEngine,
    approvalBroker,
    authorizer: createAgyPolicyAuthorizer({
      policyEngine,
      approvalBroker,
      taskIdForRun: () => "task-1",
      leaseIdsForRun: () => ({
        "workspace.read": "read-lease",
        "workspace.write": "write-lease",
        "terminal.exec": "terminal-lease",
        "browser.open": "browser-lease",
      }),
      workspacePathForLane: () => workspace,
      permissionModeForLane: () => undefined,
      approvalTimeoutMs: 1,
      approvalPollMs: 1,
      sleep: async () => undefined,
      ...overrides,
    }),
  };
}

describe("AGY policy authorizer", () => {
  it("maps documented read tools to a workspace-read lease", async () => {
    const h = dependencies();

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("view_file", { AbsolutePath: `${workspace}/src/main.ts` }),
      }),
    ).resolves.toBe("allow");

    expect(h.policyEngine.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "workspace.read",
        leaseId: "read-lease",
        resource: `${workspace}/src/main.ts`,
        risk: "read",
      }),
    );
  });

  it("fails closed for unknown tools and paths outside the task workspace", async () => {
    const h = dependencies();

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("delete_everything", {}),
      }),
    ).resolves.toBe("deny");
    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("write_to_file", { TargetFile: "../../outside.txt" }),
      }),
    ).resolves.toBe("deny");
    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("run_command", { CommandLine: "pwd" }),
      }),
    ).resolves.toBe("deny");
    expect(h.policyEngine.authorize).not.toHaveBeenCalled();
  });

  it("denies an in-workspace symlink that resolves outside the workspace", async () => {
    await symlink(outside, path.join(workspace, "escape"));
    const h = dependencies();

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("view_file", {
          AbsolutePath: path.join(workspace, "escape", "secret.txt"),
        }),
      }),
    ).resolves.toBe("deny");
    expect(h.policyEngine.authorize).not.toHaveBeenCalled();
  });

  it("denies a dangling in-workspace symlink before accepting a pending write", async () => {
    await symlink(
      path.join(outside, "missing.txt"),
      path.join(workspace, "pending"),
    );
    const h = dependencies();

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("write_to_file", {
          TargetFile: path.join(workspace, "pending"),
          Content: "must not escape",
        }),
      }),
    ).resolves.toBe("deny");
    expect(h.policyEngine.authorize).not.toHaveBeenCalled();
  });

  it("blocks writes and terminal execution in plan mode", async () => {
    const h = dependencies({ permissionModeForLane: () => "plan" });

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("write_to_file", {
          TargetFile: `${workspace}/notes.md`,
          Content: "nope",
        }),
      }),
    ).resolves.toBe("deny");
    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("run_command", {
          CommandLine: "git status",
          Cwd: workspace,
        }),
      }),
    ).resolves.toBe("deny");
    expect(h.policyEngine.authorize).not.toHaveBeenCalled();
  });

  it("maps official browser arguments without treating a web search as a URL", async () => {
    const h = dependencies();

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("search_web", { query: "Antigravity hook schema" }),
      }),
    ).resolves.toBe("allow");
    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("read_url_content", {
          Url: "https://www.antigravity.google/docs/hooks",
        }),
      }),
    ).resolves.toBe("allow");
    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("read_url_content", { Url: "file:///private/secret" }),
      }),
    ).resolves.toBe("deny");
    expect(h.policyEngine.authorize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        capability: "browser.open",
        resource: "Antigravity hook schema",
      }),
    );
  });

  it("waits a bounded time for repository approval and defaults to deny", async () => {
    const approvalBroker = {
      resolvedDecision: vi.fn(async () => "allow_once" as const),
    };
    const h = dependencies({
      policyEngine: {
        authorize: vi.fn(() => ({
          decision: "ask" as const,
          approvalId: "approval-1",
        })),
      },
      approvalBroker,
    });

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("run_command", {
          CommandLine: "git status",
          Cwd: workspace,
        }),
        onApprovalRequested: () => true,
      }),
    ).resolves.toBe("allow");
    expect(approvalBroker.resolvedDecision).toHaveBeenCalledWith("approval-1");
  });

  it("denies an unresolved approval after the bounded broker wait", async () => {
    const approvalBroker = { resolvedDecision: vi.fn(async () => undefined) };
    const h = dependencies({
      policyEngine: {
        authorize: vi.fn(() => ({
          decision: "ask" as const,
          approvalId: "approval-timeout",
        })),
      },
      approvalBroker,
      approvalTimeoutMs: 2,
      approvalPollMs: 1,
    });

    await expect(
      h.authorizer.authorize({
        runId,
        laneId,
        hook: hook("run_command", {
          CommandLine: "git status",
          Cwd: workspace,
        }),
        onApprovalRequested: () => true,
      }),
    ).resolves.toBe("deny");
    expect(approvalBroker.resolvedDecision).toHaveBeenCalledTimes(2);
  });

  it("uses only one lease set when a run emits more than one hook", async () => {
    const leases = vi.fn(() => ({ "workspace.read": "read-lease" }));
    const h = dependencies({ leaseIdsForRun: leases });

    await h.authorizer.authorize({
      runId,
      laneId,
      hook: hook("view_file", { AbsolutePath: `${workspace}/a.ts` }),
    });
    await h.authorizer.authorize({
      runId,
      laneId,
      hook: hook("list_dir", { DirectoryPath: `${workspace}/src` }),
    });

    expect(leases).toHaveBeenCalledTimes(1);
    h.authorizer.completeRun?.(runId);
    await h.authorizer.authorize({
      runId,
      laneId,
      hook: hook("view_file", { AbsolutePath: `${workspace}/a.ts` }),
    });
    expect(leases).toHaveBeenCalledTimes(2);
  });
});
