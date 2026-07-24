import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import {
  WorkspaceToolExecutor,
  type ToolExecutionContext,
} from "./workspace-tools";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("WorkspaceToolExecutor", () => {
  it("reads a file inside the workspace through an authorized capability", async () => {
    const workspace = await temporaryWorkspace();
    await writeFile(path.join(workspace, "README.md"), "Okami SDK");
    const authorize = vi.fn(async () => ({ decision: "allow" as const }));
    const tools = new WorkspaceToolExecutor({ authorize });

    const prepared = await tools.prepare(
      "read_file",
      { path: "README.md" },
      context(workspace),
    );
    const result = await prepared.execute();
    const expectedPath = await realpath(path.join(workspace, "README.md"));

    expect(result).toBe("Okami SDK");
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "workspace.read",
        resource: expectedPath,
        risk: "read",
        outsideWorkspace: false,
      }),
    );
  });

  it("denies traversal before calling policy", async () => {
    const workspace = await temporaryWorkspace();
    const authorize = vi.fn(async () => ({ decision: "allow" as const }));
    const tools = new WorkspaceToolExecutor({ authorize });

    const prepared = await tools.prepare(
      "read_file",
      { path: "../secret.txt" },
      context(workspace),
    );

    expect(prepared.authorization).toEqual({
      decision: "deny",
      reason: "outside_workspace",
    });
    await expect(prepared.execute()).rejects.toThrow("outside_workspace");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not write before a critical approval is resolved", async () => {
    const workspace = await temporaryWorkspace();
    const target = path.join(workspace, "result.txt");
    const authorize = vi.fn(async () => ({
      decision: "ask" as const,
      approvalId: "approval-1",
    }));
    const tools = new WorkspaceToolExecutor({ authorize });

    const prepared = await tools.prepare(
      "write_file",
      { path: "result.txt", content: "done" },
      context(workspace),
    );

    expect(prepared.authorization).toEqual({
      decision: "ask",
      approvalId: "approval-1",
    });
    await expect(readFile(target, "utf8")).rejects.toThrow();
    await prepared.execute();
    await expect(readFile(target, "utf8")).resolves.toBe("done");
  });

  it("rejects destructive shell commands in the embedded harness", async () => {
    const workspace = await temporaryWorkspace();
    const authorize = vi.fn(async () => ({ decision: "allow" as const }));
    const runCommand = vi.fn();
    const tools = new WorkspaceToolExecutor({ authorize, runCommand });

    const prepared = await tools.prepare(
      "run_command",
      { command: "rm -rf ./src" },
      context(workspace),
    );

    expect(prepared.authorization).toEqual({
      decision: "deny",
      reason: "destructive_command",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });
});

async function temporaryWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "okami-sdk-tools-"));
  temporaryDirectories.push(directory);
  return directory;
}

function context(cwd: string): ToolExecutionContext {
  return {
    runtime: "codex",
    taskId: "33333333-3333-4333-8333-333333333333" as TaskId,
    laneId: "11111111-1111-4111-8111-111111111111" as LaneId,
    runId: "22222222-2222-4222-8222-222222222222" as RunId,
    cwd,
    permissionMode: "manual",
  };
}
