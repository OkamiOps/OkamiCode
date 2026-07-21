#!/usr/bin/env node

import { Buffer } from "node:buffer";
import net from "node:net";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

const MAX_FRAME_BYTES = 1024 * 1024;
// AGY gives hooks at most 30 seconds. Keep a small shutdown margin while still
// allowing Okami's explicit approval flow to reach the user.
const RESPONSE_TIMEOUT_MS = 25_000;
const SAFE_REASON = /^[a-z][a-z0-9_:-]{0,63}$/u;
const hookName = process.argv[2];

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function preToolOutput(decision, reason) {
  const safeReason = sanitizeReason(reason);
  return safeReason ? { decision, reason: safeReason } : { decision };
}

function passiveOutput() {
  // Stop requires a decision field. An empty decision explicitly allows the
  // native execution loop to terminate; Okami never forces another model turn.
  return hookName === "Stop" ? { decision: "" } : {};
}

function sanitizeReason(reason) {
  return typeof reason === "string" && SAFE_REASON.test(reason)
    ? reason
    : undefined;
}

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_FRAME_BYTES) throw new Error("input_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function request(socketPath, capabilityToken, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const chunks = [];
    let size = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      finish(new Error("response_timeout"));
    }, RESPONSE_TIMEOUT_MS);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    socket.once("connect", () => {
      const body = Buffer.from(
        JSON.stringify({ version: 1, capabilityToken, hookName, payload }),
        "utf8",
      );
      if (body.length > MAX_FRAME_BYTES) {
        socket.destroy();
        finish(new Error("request_too_large"));
        return;
      }
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > MAX_FRAME_BYTES + 4) {
        socket.destroy();
        finish(new Error("response_too_large"));
        return;
      }
      const frame = Buffer.concat(chunks, size);
      if (frame.length < 4) return;
      const length = frame.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES || frame.length > length + 4) {
        socket.destroy();
        finish(new Error("response_too_large"));
        return;
      }
      if (frame.length < length + 4) return;
      try {
        finish(
          undefined,
          JSON.parse(frame.subarray(4, 4 + length).toString("utf8")),
        );
      } catch {
        finish(new Error("invalid_response"));
      }
      socket.end();
    });
    socket.once("end", () => finish(new Error("incomplete_response")));
    socket.once("close", () => finish(new Error("incomplete_response")));
    socket.once("error", () => finish(new Error("bridge_unavailable")));
  });
}

try {
  const payload = await readInput();
  const socketPath = process.env.OKAMI_AGY_HOOK_SOCKET;
  const capabilityToken = process.env.OKAMI_AGY_HOOK_CAPABILITY_TOKEN;
  if (!socketPath || !capabilityToken || typeof hookName !== "string") {
    throw new Error("bridge_unavailable");
  }
  const response = await request(socketPath, capabilityToken, payload);
  if (hookName === "PreToolUse") {
    output(
      preToolOutput(
        response?.decision === "allow" ? "allow" : "deny",
        typeof response?.reason === "string" ? response.reason : undefined,
      ),
    );
  } else {
    output(passiveOutput());
  }
} catch {
  output(
    hookName === "PreToolUse"
      ? preToolOutput("deny", "bridge_error")
      : passiveOutput(),
  );
}
