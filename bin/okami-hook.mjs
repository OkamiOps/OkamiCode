#!/usr/bin/env node

import net from "node:net";
import { Buffer } from "node:buffer";
import process from "node:process";

const MAX_FRAME_BYTES = 1024 * 1024;

function permissionOutput(decision, reason) {
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    permissionDecision: decision,
  };
  if (reason) hookSpecificOutput.permissionDecisionReason = reason;
  return { hookSpecificOutput };
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_FRAME_BYTES) throw new Error("hook_input_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function request(socketPath, capabilityToken, hook) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const chunks = [];
    let size = 0;
    socket.once("connect", () => {
      const body = Buffer.from(
        JSON.stringify({ capabilityToken, hook }),
        "utf8",
      );
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > MAX_FRAME_BYTES + 4) {
        socket.destroy(new Error("hook_response_too_large"));
        return;
      }
      const buffer = Buffer.concat(chunks, size);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES) {
        socket.destroy(new Error("hook_response_too_large"));
        return;
      }
      if (buffer.length < length + 4) return;
      socket.end();
      try {
        resolve(JSON.parse(buffer.subarray(4, length + 4).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

try {
  const hook = await readInput();
  const socketPath = process.env.OKAMI_HOOK_SOCKET;
  const capabilityToken = process.env.OKAMI_HOOK_CAPABILITY_TOKEN;
  if (!socketPath || !capabilityToken)
    throw new Error("hook_bridge_unavailable");
  const response = await request(socketPath, capabilityToken, hook);
  if (hook.hook_event_name === "PreToolUse") {
    writeResult(
      permissionOutput(
        response.decision === "allow" ? "allow" : "deny",
        response.reason,
      ),
    );
  } else {
    writeResult({});
  }
} catch (error) {
  writeResult(
    permissionOutput(
      "deny",
      error instanceof Error ? error.message : "hook_bridge_error",
    ),
  );
}
