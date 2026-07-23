import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Capability } from "../../policy/action";
import { createPolicyHarness } from "../../policy/test-harness";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { RepositoryApprovalBroker } from "../codex/adapter";
import { ClaudeAdapter } from "./adapter";
import { claudeEnvironment } from "./command";
import { ClaudeHookServer, type PostToolMetadata } from "./hook-server";

type NativeRecord = Record<string, unknown>;
interface HookCliOutput {
  hookSpecificOutput: { permissionDecision?: string };
  permissionDecision?: string;
}

export function fixtureJson(filePath: string): NativeRecord;
export function fixtureJson(filePath: string): NativeRecord {
  return JSON.parse(
    readFileSync(path.resolve(filePath), "utf8"),
  ) as NativeRecord;
}

export async function startHookHarness(options: { degraded?: boolean } = {}) {
  const policy = createPolicyHarness();
  const terminalLease = policy.lease(
    "terminal.exec",
    "**",
    "2030-07-18T12:00:00.000Z",
  );
  const broker = new RepositoryApprovalBroker(policy.approvals);
  const postMetadata: PostToolMetadata[] = [];
  const hookScriptPath = path.resolve("bin/okami-hook.mjs");
  const server = new ClaudeHookServer({
    policyEngine: policy.engine,
    approvalBroker: broker,
    context: () => ({
      taskId: policy.taskId,
      laneId: policy.laneId,
      runId: policy.runId,
      leaseIds: { "terminal.exec": terminalLease.id },
      allowedWorkspaces: [process.cwd()],
      degraded: options.degraded ?? false,
    }),
    now: () => "2026-07-18T12:00:00.000Z",
    onPostToolMetadata: (metadata) => postMetadata.push(metadata),
  });
  await server.start();
  const hookEnvironment = server.hookEnvironment(claudeEnvironment());

  return {
    hookScriptPath,
    hookArgv: [hookScriptPath],
    hookEnvironment,
    socketPath: server.socketPath,
    capabilityToken: server.capabilityToken,
    requestCount: () => server.requestCount(),
    postToolMetadata: () => [...postMetadata],
    sendHook: (hook: NativeRecord) =>
      runHook(hookScriptPath, hookEnvironment, hook),
    async nextApproval() {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const row = policy.db
          .prepare("SELECT id FROM approvals WHERE status = 'pending' LIMIT 1")
          .get() as { id: string } | undefined;
        if (row) return policy.approvals.findById(row.id)!;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Timed out waiting for policy approval");
    },
    async allowOnce(approvalId: string) {
      policy.approvals.resolve(
        approvalId,
        "allow_once",
        "2026-07-18T12:00:01.000Z",
      );
    },
    async close() {
      await server.close();
      policy.db.close();
    },
  };
}

export async function startClaudeAdapterHarness(
  options: {
    command?: string;
  } = {},
) {
  const policy = createPolicyHarness();
  const capabilities: Capability[] = [
    "workspace.read",
    "workspace.write",
    "terminal.exec",
    "browser.open",
  ];
  const leaseIds = Object.fromEntries(
    capabilities.map((capability) => [
      capability,
      policy.lease(capability, "**", "2030-07-18T12:00:00.000Z").id,
    ]),
  ) as Partial<Record<Capability, string>>;
  const adapter = new ClaudeAdapter({
    policyEngine: policy.engine,
    approvalBroker: new RepositoryApprovalBroker(policy.approvals),
    taskIdForRun: () => policy.taskId as TaskId,
    leaseIdsForRun: () => leaseIds,
    command: options.command,
    env: claudeEnvironment(),
    hookScriptPath: path.resolve("bin/okami-hook.mjs"),
  });

  return {
    adapter,
    laneId: policy.laneId as LaneId,
    runId: policy.runId as RunId,
    async close() {
      policy.db.close();
    },
  };
}

export function startClaudeLiveHarness(options: { command?: string } = {}) {
  return startClaudeAdapterHarness(options);
}

async function runHook(
  hookScriptPath: string,
  environment: NodeJS.ProcessEnv,
  hook: NativeRecord,
): Promise<HookCliOutput> {
  const child = spawn(process.execPath, [hookScriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: environment,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(`${JSON.stringify(hook)}\n`);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(
      `Hook exited with ${exitCode}: ${Buffer.concat(stderr).toString("utf8")}`,
    );
  }
  return JSON.parse(Buffer.concat(stdout).toString("utf8")) as HookCliOutput;
}
