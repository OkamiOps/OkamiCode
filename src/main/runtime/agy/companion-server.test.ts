// @vitest-environment node

import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgyCompanionServer,
  type AgyCompanionHookEnvelope,
} from "./companion-server";

const MAX_FRAME_BYTES = 1024 * 1024;
const hookScript = fileURLToPath(
  new URL("../../../../bin/okami-agy-hook.mjs", import.meta.url),
);
const fixtureDirectory = fileURLToPath(
  new URL("../../../../tests/fixtures/runtime/agy/", import.meta.url),
);

const servers: AgyCompanionServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(fixtureDirectory, `${name}.json`), "utf8"),
  );
}

async function start(
  onHook: (
    envelope: AgyCompanionHookEnvelope,
  ) =>
    | { decision: "allow" | "deny"; reason?: string }
    | undefined
    | Promise<
        { decision: "allow" | "deny"; reason?: string } | undefined
      > = () => undefined,
): Promise<AgyCompanionServer> {
  const server = new AgyCompanionServer({ onHook });
  servers.push(server);
  await server.start();
  return server;
}

function startWithTimeout(
  connectionTimeoutMs: number,
): Promise<AgyCompanionServer> {
  const server = new AgyCompanionServer({
    onHook: () => undefined,
    connectionTimeoutMs,
  });
  servers.push(server);
  return server.start().then(() => server);
}

function request(
  socketPath: string,
  value: unknown,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const chunks: Buffer[] = [];
    socket.once("connect", () => {
      const body = Buffer.from(JSON.stringify(value));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => {
      const frame = Buffer.concat(chunks);
      if (frame.length < 4) return reject(new Error("missing response frame"));
      resolve(
        JSON.parse(
          frame.subarray(4, 4 + frame.readUInt32BE(0)).toString("utf8"),
        ) as Record<string, unknown>,
      );
    });
    socket.once("error", reject);
  });
}

function oversizedRequest(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(MAX_FRAME_BYTES + 1);
      socket.end(header);
    });
    socket.once("close", () => resolve());
    socket.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
  });
}

function runHook(
  server: AgyCompanionServer,
  hookName: string,
  payload: unknown,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, hookName], {
      env: server.hookEnvironment({ PATH: process.env.PATH }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`hook exited ${code}`)),
    );
    child.stdin.end(JSON.stringify(payload));
  });
}

function runHookWithEnvironment(
  environment: NodeJS.ProcessEnv,
  hookName: string,
  payload: unknown,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, hookName], {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("hook test timed out"));
    }, 2_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`hook exited ${code}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function truncatedResponseEnvironment(): Promise<{
  environment: NodeJS.ProcessEnv;
  close: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "okami-agy-test-"));
  const socketPath = path.join(directory, "truncated.sock");
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(8);
      socket.end(Buffer.concat([header, Buffer.from("{}")]));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    environment: {
      PATH: process.env.PATH,
      OKAMI_AGY_HOOK_SOCKET: socketPath,
      OKAMI_AGY_HOOK_CAPABILITY_TOKEN: "test-token",
    },
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rmdir(directory);
    },
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("AgyCompanionServer", () => {
  it("authenticates and validates every official hook before forwarding it", async () => {
    const received: AgyCompanionHookEnvelope[] = [];
    const server = await start((envelope) => {
      received.push(envelope);
      return envelope.hookName === "PreToolUse"
        ? { decision: "deny", reason: "approval_required" }
        : undefined;
    });

    for (const [hookName, fileName] of [
      ["PreInvocation", "pre-invocation"],
      ["PreToolUse", "pre-tool-use"],
      ["PostToolUse", "post-tool-use"],
      ["Stop", "stop"],
    ]) {
      const response = await request(server.socketPath, {
        version: 1,
        capabilityToken: server.capabilityToken,
        hookName,
        payload: fixture(fileName),
      });
      expect(response).toEqual(
        hookName === "PreToolUse"
          ? { decision: "deny", reason: "approval_required" }
          : {},
      );
    }
    expect(received.map((entry) => entry.hookName)).toEqual([
      "PreInvocation",
      "PreToolUse",
      "PostToolUse",
      "Stop",
    ]);
  });

  it("fails closed for invalid token, version, hook, and payload without calling onHook", async () => {
    const received: AgyCompanionHookEnvelope[] = [];
    const server = await start((envelope) => {
      received.push(envelope);
    });
    const base = { hookName: "PreToolUse", payload: fixture("pre-tool-use") };

    await expect(
      request(server.socketPath, {
        ...base,
        version: 1,
        capabilityToken: "invalid",
      }),
    ).resolves.toEqual({
      decision: "deny",
      reason: "invalid_capability_token",
    });
    await expect(
      request(server.socketPath, {
        ...base,
        version: 2,
        capabilityToken: server.capabilityToken,
      }),
    ).resolves.toEqual({ decision: "deny", reason: "unsupported_version" });
    await expect(
      request(server.socketPath, {
        ...base,
        hookName: "unknown",
        version: 1,
        capabilityToken: server.capabilityToken,
      }),
    ).resolves.toEqual({ decision: "deny", reason: "invalid_hook" });
    await expect(
      request(server.socketPath, {
        ...base,
        payload: {},
        version: 1,
        capabilityToken: server.capabilityToken,
      }),
    ).resolves.toEqual({ decision: "deny", reason: "invalid_payload" });
    expect(received).toEqual([]);
  });

  it("sanitizes callback denial reasons at the transport boundary", async () => {
    const secretLikeReason = `payload:${JSON.stringify({ token: "do-not-echo" })}`;
    const server = await start(() => ({
      decision: "deny",
      reason: `${secretLikeReason}-${"x".repeat(100)}`,
    }));

    await expect(
      request(server.socketPath, {
        version: 1,
        capabilityToken: server.capabilityToken,
        hookName: "PreToolUse",
        payload: fixture("pre-tool-use"),
      }),
    ).resolves.toEqual({ decision: "deny" });
    const result = await runHook(server, "PreToolUse", fixture("pre-tool-use"));
    expect(result.stdout).not.toContain("do-not-echo");
    expect(JSON.parse(result.stdout)).toEqual({ decision: "deny" });
  });

  it("caps frames, uses private filesystem permissions, preserves hook environment, and cleans up", async () => {
    const server = await start();
    expect(statSync(server.socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(server.socketPath)).mode & 0o777).toBe(0o700);
    expect(server.hookEnvironment({ KEEP: "yes" })).toEqual({
      KEEP: "yes",
      OKAMI_AGY_HOOK_SOCKET: server.socketPath,
      OKAMI_AGY_HOOK_CAPABILITY_TOKEN: server.capabilityToken,
    });
    await oversizedRequest(server.socketPath);
    await server.close();
    await server.close();
    expect(() => statSync(server.socketPath)).toThrow();
    expect(() => statSync(path.dirname(server.socketPath))).toThrow();
  });

  it("emits only the official hook output shape without leaking transport data", async () => {
    const server = await start(() => ({ decision: "allow" }));
    for (const [hookName, fileName, expected] of [
      ["PreToolUse", "pre-tool-use", { decision: "allow" }],
      ["PreInvocation", "pre-invocation", {}],
      ["PostToolUse", "post-tool-use", {}],
      ["Stop", "stop", { decision: "" }],
    ] as const) {
      const result = await runHook(server, hookName, fixture(fileName));
      expect(JSON.parse(result.stdout)).toEqual(expected);
      expect(result.stderr).toBe("");
    }
  });

  it("rejects an incomplete helper response on EOF and returns a bounded denial", async () => {
    const fake = await truncatedResponseEnvironment();
    try {
      await expect(
        runHookWithEnvironment(
          fake.environment,
          "PreToolUse",
          fixture("pre-tool-use"),
        ),
      ).resolves.toEqual({
        stdout: '{"decision":"deny","reason":"bridge_error"}\n',
        stderr: "",
      });
    } finally {
      await fake.close();
    }
  }, 3_000);

  it("shares concurrent startup and makes a start/close race close-wins", async () => {
    const concurrent = new AgyCompanionServer({ onHook: () => undefined });
    servers.push(concurrent);
    await Promise.all([concurrent.start(), concurrent.start()]);
    expect(statSync(concurrent.socketPath).mode & 0o777).toBe(0o600);

    const racing = new AgyCompanionServer({ onHook: () => undefined });
    servers.push(racing);
    const starting = racing.start();
    const closing = racing.close();
    await Promise.all([starting, closing]);
    expect(() => statSync(racing.socketPath)).toThrow();
    expect(() => statSync(path.dirname(racing.socketPath))).toThrow();
  });

  it("times out partial connections and lets close finish without waiting for a peer", async () => {
    const server = await startWithTimeout(20);
    const socket = net.createConnection(server.socketPath);
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(Buffer.from([0, 0]));
    await wait(50);
    expect(socket.destroyed).toBe(true);

    const stuckServer = await start();
    const stuckSocket = net.createConnection(stuckServer.socketPath);
    await new Promise<void>((resolve) => stuckSocket.once("connect", resolve));
    stuckSocket.write(Buffer.from([0, 0]));
    const closeFinished = await Promise.race([
      stuckServer.close().then(() => true),
      wait(100).then(() => false),
    ]);
    stuckSocket.destroy();
    expect(closeFinished).toBe(true);
  });

  it("uses the connection timeout only while receiving a frame", async () => {
    const server = new AgyCompanionServer({
      connectionTimeoutMs: 20,
      onHook: async () => {
        await wait(40);
        return { decision: "allow" };
      },
    });
    servers.push(server);
    await server.start();

    await expect(
      request(server.socketPath, {
        version: 1,
        capabilityToken: server.capabilityToken,
        hookName: "PreToolUse",
        payload: fixture("pre-tool-use"),
      }),
    ).resolves.toEqual({ decision: "allow" });
  });
});
