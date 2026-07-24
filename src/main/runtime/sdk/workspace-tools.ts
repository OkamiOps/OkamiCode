import { execFile } from "node:child_process";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RuntimeKind } from "../../../shared/contracts/lane";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import type { Capability, RiskLevel } from "../../policy/action";

const execFileAsync = promisify(execFile);
const MAX_TOOL_OUTPUT = 200_000;

export interface ToolExecutionContext {
  runtime: RuntimeKind;
  taskId: TaskId;
  laneId: LaneId;
  runId: RunId;
  cwd: string;
  permissionMode?: string;
}

export type ToolAuthorization =
  | { decision: "allow" }
  | { decision: "ask"; approvalId: string }
  | { decision: "deny"; reason: string };

export interface ToolAuthorizationRequest extends ToolExecutionContext {
  capability: Capability;
  resource: string;
  risk: RiskLevel;
  destructive: boolean;
  outsideWorkspace: boolean;
}

export interface PreparedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  authorization: ToolAuthorization;
  capability: Capability;
  resource: string;
  execute(): Promise<string>;
}

export interface WorkspaceToolExecutorDependencies {
  authorize(
    request: ToolAuthorizationRequest,
  ): ToolAuthorization | Promise<ToolAuthorization>;
  runCommand?: (
    command: string,
    options: { cwd: string; signal?: AbortSignal },
  ) => Promise<{ stdout: string; stderr: string }>;
}

export class WorkspaceToolExecutor {
  constructor(
    private readonly dependencies: WorkspaceToolExecutorDependencies,
  ) {}

  definitions(): Array<Record<string, unknown>> {
    return [
      tool("read_file", "Read a UTF-8 file inside the workspace", {
        path: stringProperty("Workspace-relative path"),
      }),
      tool("list_directory", "List one directory inside the workspace", {
        path: stringProperty("Workspace-relative directory, or ."),
      }),
      tool("search_files", "Search workspace text using a regular expression", {
        query: stringProperty("Regular expression"),
        path: stringProperty("Workspace-relative search root, or ."),
      }),
      tool("write_file", "Write a complete UTF-8 file inside the workspace", {
        path: stringProperty("Workspace-relative target path"),
        content: stringProperty("Complete file content"),
      }),
      tool("run_command", "Run one command from the workspace root", {
        command: stringProperty("Command to execute"),
      }),
    ];
  }

  async prepare(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<PreparedToolCall> {
    if (name === "run_command") {
      return this.prepareCommand(argumentsValue, context);
    }
    const requestedPath = requiredString(argumentsValue.path, "path");
    const access = name === "write_file" ? "write" : "read";
    const resolved = await workspacePath(context.cwd, requestedPath, access);
    if (!resolved) {
      return denied(
        name,
        argumentsValue,
        access === "write" ? "workspace.write" : "workspace.read",
        requestedPath,
        "outside_workspace",
      );
    }
    if (name === "read_file") {
      return this.authorized(
        name,
        argumentsValue,
        context,
        "workspace.read",
        resolved,
        "read",
        false,
        async () => limit(await readFile(resolved, "utf8")),
      );
    }
    if (name === "list_directory") {
      return this.authorized(
        name,
        argumentsValue,
        context,
        "workspace.read",
        resolved,
        "read",
        false,
        async () => {
          const entries = await readdir(resolved, { withFileTypes: true });
          return entries
            .map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`)
            .join("\n");
        },
      );
    }
    if (name === "search_files") {
      const query = requiredString(argumentsValue.query, "query");
      return this.authorized(
        name,
        argumentsValue,
        context,
        "workspace.read",
        resolved,
        "read",
        false,
        async () => {
          const result = await execFileAsync(
            "rg",
            ["--line-number", "--no-heading", "--color", "never", query, "."],
            { cwd: resolved, maxBuffer: MAX_TOOL_OUTPUT },
          ).catch((error: unknown) => {
            if (
              error !== null &&
              typeof error === "object" &&
              "code" in error &&
              error.code === 1
            ) {
              return { stdout: "", stderr: "" };
            }
            throw error;
          });
          return limit(String(result.stdout));
        },
      );
    }
    if (name === "write_file") {
      if (context.permissionMode === "plan") {
        return denied(
          name,
          argumentsValue,
          "workspace.write",
          resolved,
          "plan_mode",
        );
      }
      const content = requiredString(argumentsValue.content, "content", true);
      return this.authorized(
        name,
        argumentsValue,
        context,
        "workspace.write",
        resolved,
        "critical",
        true,
        async () => {
          await writeFile(resolved, content, "utf8");
          return `Wrote ${Buffer.byteLength(content)} bytes to ${requestedPath}`;
        },
      );
    }
    return denied(
      name,
      argumentsValue,
      "workspace.read",
      resolved,
      "unknown_tool",
    );
  }

  private async prepareCommand(
    argumentsValue: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<PreparedToolCall> {
    const command = requiredString(argumentsValue.command, "command");
    if (destructiveCommand(command)) {
      return denied(
        "run_command",
        argumentsValue,
        "terminal.exec",
        command,
        "destructive_command",
      );
    }
    if (context.permissionMode === "plan") {
      return denied(
        "run_command",
        argumentsValue,
        "terminal.exec",
        command,
        "plan_mode",
      );
    }
    const workspace = await realpath(context.cwd).catch(() => null);
    if (!workspace) {
      return denied(
        "run_command",
        argumentsValue,
        "terminal.exec",
        command,
        "workspace_unavailable",
      );
    }
    const runCommand = this.dependencies.runCommand ?? defaultRunCommand;
    return this.authorized(
      "run_command",
      argumentsValue,
      context,
      "terminal.exec",
      command,
      "critical",
      false,
      async () => {
        const result = await runCommand(command, { cwd: workspace });
        return limit(
          [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
        );
      },
    );
  }

  private async authorized(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolExecutionContext,
    capability: Capability,
    resource: string,
    risk: RiskLevel,
    destructive: boolean,
    execute: () => Promise<string>,
  ): Promise<PreparedToolCall> {
    const authorization = await this.dependencies.authorize({
      ...context,
      capability,
      resource,
      risk,
      destructive,
      outsideWorkspace: false,
    });
    return {
      name,
      arguments: argumentsValue,
      authorization,
      capability,
      resource,
      async execute() {
        if (authorization.decision === "deny") {
          throw new Error(authorization.reason);
        }
        return execute();
      },
    };
  }
}

function denied(
  name: string,
  argumentsValue: Record<string, unknown>,
  capability: Capability,
  resource: string,
  reason: string,
): PreparedToolCall {
  return {
    name,
    arguments: argumentsValue,
    authorization: { decision: "deny", reason },
    capability,
    resource,
    execute: () => Promise.reject(new Error(reason)),
  };
}

async function workspacePath(
  workspaceValue: string,
  requestedPath: string,
  access: "read" | "write",
): Promise<string | null> {
  const workspace = await realpath(workspaceValue).catch(() => null);
  if (!workspace) return null;
  const declared = path.resolve(workspace, requestedPath);
  if (!isWithin(declared, workspace)) return null;
  if (access === "read") {
    const resolved = await realpath(declared).catch(() => null);
    return resolved && isWithin(resolved, workspace) ? resolved : null;
  }
  const parent = await nearestExistingParent(path.dirname(declared));
  if (!parent || !isWithin(parent, workspace)) return null;
  const existing = await stat(declared)
    .then(() => true)
    .catch(() => false);
  if (existing) {
    const resolved = await realpath(declared).catch(() => null);
    if (!resolved || !isWithin(resolved, workspace)) return null;
  }
  return declared;
}

async function nearestExistingParent(value: string): Promise<string | null> {
  for (let candidate = value; ; candidate = path.dirname(candidate)) {
    const resolved = await realpath(candidate).catch(() => null);
    if (resolved) return resolved;
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
  }
}

function isWithin(target: string, workspace: string): boolean {
  const relative = path.relative(workspace, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function destructiveCommand(command: string): boolean {
  return /(?:^|[;&|]\s*)(?:sudo\s+)?(?:rm|rmdir)\b|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|mkfs\b|diskutil\s+erase/iu.test(
    command,
  );
}

async function defaultRunCommand(
  command: string,
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("/bin/zsh", ["-lc", command], {
    cwd: options.cwd,
    maxBuffer: MAX_TOOL_OUTPUT,
    timeout: 120_000,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    },
  };
}

function stringProperty(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function requiredString(
  value: unknown,
  name: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function limit(value: string): string {
  return value.length <= MAX_TOOL_OUTPUT
    ? value
    : `${value.slice(0, MAX_TOOL_OUTPUT)}\n[truncated]`;
}
