#!/usr/bin/env node

import readline from "node:readline";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2.1.214 (Claude Code)\n");
  process.exit(0);
}
if (args.includes("--help")) {
  process.stdout.write(
    [
      "--print",
      "--input-format",
      "--output-format",
      "--include-partial-messages",
      "--include-hook-events",
      "--replay-user-messages",
      "--permission-mode",
      "--settings",
      "--session-id",
      "--resume",
      "--verbose",
    ].join(" "),
  );
  process.exit(0);
}

const bindingFlag = args.includes("--resume") ? "--resume" : "--session-id";
const sessionId = args[args.indexOf(bindingFlag) + 1];
if (!sessionId) process.exit(2);

let initialized = false;
const noInputDeadline = setTimeout(() => process.exit(3), 1_000);
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  clearTimeout(noInputDeadline);
  const user = JSON.parse(line);
  if (!initialized) {
    initialized = true;
    emit({
      type: "system",
      subtype: "hook_started",
      hook_id: "fixture-session-hook",
      hook_name: "fixture-session-start",
      hook_event: "SessionStart",
      uuid: "fixture-session-hook-start",
      session_id: sessionId,
    });
    emit({
      type: "system",
      subtype: "init",
      uuid: "fixture-init",
      session_id: sessionId,
      apiKeySource: "oauth",
      claude_code_version: "2.1.214",
      model: "claude-sonnet-4-6",
    });
  }
  emit({ ...user, uuid: "fixture-user", session_id: sessionId });
  emit({
    type: "assistant",
    uuid: "fixture-assistant",
    session_id: sessionId,
    message: {
      id: "fixture-message",
      role: "assistant",
      content: [{ type: "text", text: "lazy init exercised" }],
    },
  });
  emit({
    type: "result",
    subtype: "success",
    uuid: "fixture-result",
    session_id: sessionId,
    is_error: false,
    result: "lazy init exercised",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
});

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
