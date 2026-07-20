import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, unlink } from "node:fs/promises";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";
import type { Capability, RiskLevel } from "../../policy/action";
import type { AuthorizationRequest, PolicyEngine } from "../../policy/engine";
import type { ApprovalBroker } from "../codex/adapter";

const MAX_FRAME_BYTES = 1024 * 1024;
const APPROVAL_POLL_MS = 10;
const APPROVAL_TIMEOUT_MS = 30_000;

type NativeRecord = Record<string, unknown>;

export interface ClaudeHookContext {
  taskId: string;
  laneId: string;
  runId: string;
  leaseIds: Partial<Record<Capability, string>>;
  allowedWorkspaces: string[];
  degraded: boolean;
}

export interface PostToolMetadata {
  sessionId?: string;
  toolName?: string;
  toolUseId?: string;
  succeeded: boolean;
}

export interface ClaudeHookServerOptions {
  policyEngine: Pick<PolicyEngine, "authorize">;
  approvalBroker: ApprovalBroker;
  context: () => ClaudeHookContext | undefined;
  now?: () => string;
  onPostToolMetadata?: (metadata: PostToolMetadata) => void;
}

interface HookAction {
  capability: Capability;
  resource: string;
  risk: RiskLevel;
  writeOrExecute: boolean;
}

interface BridgeRequest {
  capabilityToken?: unknown;
  hook?: unknown;
}

interface BridgeResponse {
  decision: "allow" | "deny" | "metadata";
  reason?: string;
}

export class ClaudeHookServer {
  readonly socketPath: string;
  readonly capabilityToken: string;
  private server: Server | undefined;
  private requests = 0;

  constructor(private readonly options: ClaudeHookServerOptions) {
    this.socketPath = path.join("/tmp", `okami-hook-${randomUUID()}.sock`);
    this.capabilityToken = randomBytes(32).toString("base64url");
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = net.createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => {
        server.off("listening", ready);
        reject(error);
      };
      const ready = () => {
        server.off("error", fail);
        resolve();
      };
      server.once("error", fail);
      server.once("listening", ready);
      server.listen(this.socketPath);
    });
    await chmod(this.socketPath, 0o600);
  }

  hookEnvironment(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...base,
      OKAMI_HOOK_SOCKET: this.socketPath,
      OKAMI_HOOK_CAPABILITY_TOKEN: this.capabilityToken,
    };
  }

  requestCount(): number {
    return this.requests;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await unlink(this.socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  private accept(socket: Socket): void {
    const chunks: Buffer[] = [];
    let size = 0;
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > MAX_FRAME_BYTES + 4) socket.destroy();
      this.consumeFrame(socket, Buffer.concat(chunks, size));
    });
    socket.on("error", () => undefined);
  }

  private consumeFrame(socket: Socket, buffer: Buffer): void {
    if (buffer.length < 4) return;
    const frameLength = buffer.readUInt32BE(0);
    if (frameLength > MAX_FRAME_BYTES) {
      socket.destroy();
      return;
    }
    if (buffer.length < frameLength + 4) return;
    socket.pause();
    this.requests += 1;
    void this.handleFrame(buffer.subarray(4, frameLength + 4))
      .then((response) => writeFrame(socket, response))
      .catch(() =>
        writeFrame(socket, { decision: "deny", reason: "bridge_error" }),
      );
  }

  private async handleFrame(frame: Buffer): Promise<BridgeResponse> {
    const request = JSON.parse(frame.toString("utf8")) as BridgeRequest;
    if (!validToken(request.capabilityToken, this.capabilityToken)) {
      return { decision: "deny", reason: "invalid_capability_token" };
    }
    const hook = record(request.hook);
    if (!hook) return { decision: "deny", reason: "invalid_hook_payload" };
    const hookEventName = string(hook.hook_event_name);
    if (hookEventName === "PostToolUse") {
      this.options.onPostToolMetadata?.(postToolMetadata(hook));
      return { decision: "metadata" };
    }
    if (hookEventName !== "PreToolUse") {
      return { decision: "deny", reason: "unsupported_hook_event" };
    }

    const context = this.options.context();
    if (!context) {
      return { decision: "deny", reason: "unclassified_tool" };
    }
    const action = classifyHook(hook, context.allowedWorkspaces);
    if (!action) {
      // Unclassified tools are the harness's own plumbing (TodoWrite, Task,
      // SlashCommand, …). Denying them cripples the agent; the workspace
      // allowlist and the leased capabilities still bound the real effects.
      return { decision: "allow" };
    }
    if (
      (action.capability === "workspace.read" ||
        action.capability === "workspace.write") &&
      !withinAllowedWorkspace(action.resource, context.allowedWorkspaces)
    ) {
      return { decision: "deny", reason: "workspace_not_allowlisted" };
    }
    if (context.degraded && action.writeOrExecute) {
      return { decision: "deny", reason: "degraded_mode" };
    }

    const authorization: AuthorizationRequest = {
      leaseId: context.leaseIds[action.capability],
      actor: { kind: "runtime", runtime: "claude" },
      taskId: context.taskId,
      laneId: context.laneId,
      runId: context.runId,
      capability: action.capability,
      resource: action.resource,
      risk: action.risk,
      now: (this.options.now ?? (() => new Date().toISOString()))(),
    };
    const decision = this.options.policyEngine.authorize(authorization);
    if (decision.decision === "allow") return { decision: "allow" };
    if (decision.decision === "deny") {
      return { decision: "deny", reason: decision.reason };
    }
    return this.waitForApproval(decision.approvalId);
  }

  private async waitForApproval(approvalId: string): Promise<BridgeResponse> {
    const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const resolution =
        await this.options.approvalBroker.resolvedDecision(approvalId);
      if (resolution) {
        return resolution === "allow_once"
          ? { decision: "allow" }
          : { decision: "deny", reason: "approval_denied" };
      }
      await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_MS));
    }
    return { decision: "deny", reason: "approval_timeout" };
  }
}

function classifyHook(
  hook: NativeRecord,
  allowedWorkspaces: string[],
): HookAction | undefined {
  const toolName = string(hook.tool_name);
  const input = record(hook.tool_input) ?? {};
  if (toolName === "Bash") {
    return {
      capability: "terminal.exec",
      resource: string(input.command) ?? "",
      risk: "execute",
      writeOrExecute: true,
    };
  }
  if (["Edit", "Write", "NotebookEdit"].includes(toolName ?? "")) {
    return {
      capability: "workspace.write",
      resource: workspaceResource(input, allowedWorkspaces),
      risk: "execute",
      writeOrExecute: true,
    };
  }
  if (["Read", "Glob", "Grep"].includes(toolName ?? "")) {
    return {
      capability: "workspace.read",
      resource: workspaceResource(input, allowedWorkspaces),
      risk: "read",
      writeOrExecute: false,
    };
  }
  if (["WebFetch", "WebSearch"].includes(toolName ?? "")) {
    return {
      capability: "browser.open",
      resource: string(input.url ?? input.query) ?? "",
      risk: "execute",
      writeOrExecute: true,
    };
  }
  return undefined;
}

function workspaceResource(
  input: NativeRecord,
  allowedWorkspaces: string[],
): string {
  const candidate = string(input.file_path ?? input.path) ?? "";
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  return path.resolve(allowedWorkspaces[0] ?? "/invalid", candidate);
}

function withinAllowedWorkspace(
  resource: string,
  allowedWorkspaces: string[],
): boolean {
  return allowedWorkspaces.some((workspace) => {
    const relative = path.relative(
      path.resolve(workspace),
      path.resolve(resource),
    );
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });
}

function postToolMetadata(hook: NativeRecord): PostToolMetadata {
  const response = record(hook.tool_response);
  return {
    sessionId: string(hook.session_id),
    toolName: string(hook.tool_name),
    toolUseId: string(hook.tool_use_id),
    succeeded:
      response?.is_error !== true &&
      (typeof response?.exitCode !== "number" || response.exitCode === 0),
  };
}

function validToken(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function writeFrame(socket: Socket, response: BridgeResponse): void {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(response));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  socket.end(Buffer.concat([header, body]));
}

function record(value: unknown): NativeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeRecord)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
