import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, rmdir, unlink } from "node:fs/promises";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseAgyHook, type AgyHookName } from "./hook-contract";

const MAX_FRAME_BYTES = 1024 * 1024;
const CONNECTION_TIMEOUT_MS = 5_000;
const SAFE_REASON = /^[a-z][a-z0-9_:-]{0,63}$/u;

export interface AgyCompanionHookEnvelope {
  hookName: AgyHookName;
  payload: unknown;
}

export interface AgyCompanionDecision {
  decision: "allow" | "deny";
  reason?: string;
}

export interface AgyCompanionServerOptions {
  onHook: (
    envelope: AgyCompanionHookEnvelope,
  ) =>
    | AgyCompanionDecision
    | undefined
    | Promise<AgyCompanionDecision | undefined>;
  connectionTimeoutMs?: number;
}

interface CompanionRequest {
  version?: unknown;
  capabilityToken?: unknown;
  hookName?: unknown;
  payload?: unknown;
}

type CompanionResponse = AgyCompanionDecision | Record<never, never>;

/** Local, single-use authenticated ingress for AGY's official hooks. */
export class AgyCompanionServer {
  socketPath = "";
  readonly capabilityToken = randomBytes(32).toString("base64url");
  private directory = "";
  private server: Server | undefined;
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: AgyCompanionServerOptions) {}

  start(): Promise<void> {
    if (this.closePromise) return Promise.reject(new Error("server_closed"));
    this.startPromise ??= this.startOnce();
    return this.startPromise;
  }

  private async startOnce(): Promise<void> {
    const directory = await mkdtemp(path.join(tmpdir(), "okami-agy-"));
    this.directory = directory;
    await chmod(directory, 0o700);
    this.socketPath = path.join(directory, "hook.sock");

    const server = net.createServer((socket) => this.accept(socket));
    this.server = server;
    try {
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
    } catch (error) {
      this.server = undefined;
      await this.removeFiles();
      throw error;
    }
  }

  hookEnvironment(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...base,
      OKAMI_AGY_HOOK_SOCKET: this.socketPath,
      OKAMI_AGY_HOOK_CAPABILITY_TOKEN: this.capabilityToken,
    };
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    await this.startPromise?.catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await this.removeFiles();
  }

  private async removeFiles(): Promise<void> {
    if (this.socketPath) {
      await unlink(this.socketPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    if (this.directory) {
      await rmdir(this.directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    socket.setTimeout(
      this.options.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS,
      () => socket.destroy(),
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let consumed = false;
    socket.on("data", (chunk: Buffer) => {
      if (consumed) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size > MAX_FRAME_BYTES + 4) {
        socket.destroy();
        return;
      }
      const buffer = Buffer.concat(chunks, size);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES || buffer.length > length + 4) {
        socket.destroy();
        return;
      }
      if (buffer.length < length + 4) return;
      consumed = true;
      // The short timeout protects the framing phase. Once the authenticated
      // hook is complete, the explicit approval callback may legitimately
      // wait longer (the helper keeps the overall hook below AGY's limit).
      socket.setTimeout(0);
      socket.pause();
      void this.handleFrame(buffer.subarray(4, length + 4)).then(
        (response) => writeFrame(socket, response),
        () => writeFrame(socket, { decision: "deny", reason: "bridge_error" }),
      );
    });
    socket.on("error", () => undefined);
  }

  private async handleFrame(frame: Buffer): Promise<CompanionResponse> {
    const request = parseRequest(frame);
    if (!request) return { decision: "deny", reason: "invalid_request" };
    if (request.version !== 1) {
      return { decision: "deny", reason: "unsupported_version" };
    }
    if (!validToken(request.capabilityToken, this.capabilityToken)) {
      return { decision: "deny", reason: "invalid_capability_token" };
    }
    if (typeof request.hookName !== "string") {
      return { decision: "deny", reason: "invalid_hook" };
    }
    let hook: ReturnType<typeof parseAgyHook>;
    try {
      hook = parseAgyHook(request.hookName, request.payload);
    } catch {
      return { decision: "deny", reason: "invalid_payload" };
    }
    if (!hook) return { decision: "deny", reason: "invalid_hook" };

    let decision: AgyCompanionDecision | undefined;
    try {
      decision = await this.options.onHook({
        hookName: hook.hookName,
        payload: request.payload,
      });
    } catch {
      return { decision: "deny", reason: "hook_error" };
    }
    if (hook.hookName !== "PreToolUse") return {};
    if (decision?.decision === "allow" || decision?.decision === "deny") {
      return responseFor(decision);
    }
    return { decision: "deny", reason: "approval_required" };
  }
}

function parseRequest(frame: Buffer): CompanionRequest | undefined {
  try {
    const value = JSON.parse(frame.toString("utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as CompanionRequest)
      : undefined;
  } catch {
    return undefined;
  }
}

function validToken(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function responseFor(decision: AgyCompanionDecision): AgyCompanionDecision {
  const reason = sanitizeReason(decision.reason);
  return reason === undefined
    ? { decision: decision.decision }
    : { decision: decision.decision, reason };
}

function sanitizeReason(reason: unknown): string | undefined {
  return typeof reason === "string" && SAFE_REASON.test(reason)
    ? reason
    : undefined;
}

function writeFrame(socket: Socket, response: CompanionResponse): void {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(response), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  socket.end(Buffer.concat([header, body]));
}
