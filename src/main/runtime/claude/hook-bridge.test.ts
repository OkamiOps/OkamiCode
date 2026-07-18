import path from "node:path";
import { describe, expect, it } from "vitest";
import { newRunId } from "../../../shared/ids";
import {
  assessClaudeCapabilities,
  claudeArgs,
  createClaudeSettings,
} from "./command";
import {
  fixtureJson,
  startClaudeAdapterHarness,
  startHookHarness,
} from "./test-harness";

const settingsPath = "/tmp/okami-claude-settings.json";
const sessionId = "11111111-1111-4111-8111-111111111111";

describe("Claude command contract", () => {
  it("uses the exact stream-json flags with an exclusive session binding", () => {
    const base = [
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--include-hook-events",
      "--replay-user-messages",
      "--permission-mode",
      "manual",
      "--settings",
      settingsPath,
    ];

    expect(claudeArgs({ settingsPath, sessionId })).toEqual([
      ...base,
      "--session-id",
      sessionId,
    ]);
    expect(claudeArgs({ settingsPath, resumeId: sessionId })).toEqual([
      ...base,
      "--resume",
      sessionId,
    ]);
    expect(() => claudeArgs({ settingsPath })).toThrow(/exactly one/i);
    expect(() =>
      claudeArgs({ settingsPath, sessionId, resumeId: sessionId }),
    ).toThrow(/exactly one/i);
    expect(
      [...base, ...claudeArgs({ settingsPath, sessionId })].join(" "),
    ).not.toContain("dangerously-skip-permissions");
  });

  it("degrades when the required capability surface is incomplete", () => {
    const ready = assessClaudeCapabilities(
      "2.1.214 (Claude Code)",
      `${claudeArgs({ settingsPath, sessionId }).join(" ")} --resume --verbose`,
    );
    const degraded = assessClaudeCapabilities(
      "2.1.214 (Claude Code)",
      "--print --input-format --output-format --permission-mode --settings",
    );

    expect(ready.mode).toBe("ready");
    expect(degraded).toMatchObject({ mode: "degraded", supported: false });
  });

  it("uses environment-only hook credentials and fail-closed degraded settings", () => {
    const settings = createClaudeSettings({
      allowedWorkspaces: ["/workspace/allowed"],
      hookScriptPath: "/workspace/bin/okami-hook.mjs",
      degraded: true,
    });
    const serialized = JSON.stringify(settings);

    expect(settings.permissions.additionalDirectories).toEqual([
      "/workspace/allowed",
    ]);
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["Bash", "Edit", "Write", "NotebookEdit"]),
    );
    expect(serialized).toContain("/workspace/bin/okami-hook.mjs");
    expect(settings.hooks.PreToolUse[0]?.hooks[0]).toMatchObject({
      command: "/workspace/bin/okami-hook.mjs",
      args: [],
    });
    expect(serialized).not.toContain("OKAMI_HOOK_SOCKET");
    expect(serialized).not.toContain("OKAMI_HOOK_CAPABILITY_TOKEN");
    expect(serialized).not.toContain("dangerously-skip-permissions");
  });
});

describe("okami-hook bridge", () => {
  it("waits for the same policy broker as the UI", async () => {
    const harness = await startHookHarness();
    try {
      expect(harness.hookArgv).toEqual([harness.hookScriptPath]);
      expect(harness.hookEnvironment.OKAMI_HOOK_SOCKET).toBe(
        harness.socketPath,
      );
      expect(harness.hookEnvironment.OKAMI_HOOK_CAPABILITY_TOKEN).toBe(
        harness.capabilityToken,
      );
      expect(harness.hookArgv.join(" ")).not.toContain(harness.socketPath);
      expect(harness.hookArgv.join(" ")).not.toContain(harness.capabilityToken);

      const pending = harness.sendHook(
        fixtureJson("tests/fixtures/runtime/claude/tool-hook.json"),
      );
      const approval = await harness.nextApproval();
      await harness.allowOnce(approval.id);
      const result = await pending;

      expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
      expect(harness.requestCount()).toBe(1);
    } finally {
      await harness.close();
    }
  });

  it("reports PostToolUse metadata without granting authority", async () => {
    const harness = await startHookHarness();
    try {
      const result = await harness.sendHook({
        ...fixtureJson("tests/fixtures/runtime/claude/tool-hook.json"),
        hook_event_name: "PostToolUse",
        tool_response: { exitCode: 0 },
      });

      expect(result.hookSpecificOutput).toBeUndefined();
      expect(result.permissionDecision).toBeUndefined();
      expect(harness.postToolMetadata()).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it("denies write or execute tools before policy approval in degraded mode", async () => {
    const harness = await startHookHarness({ degraded: true });
    try {
      const result = await harness.sendHook(
        fixtureJson("tests/fixtures/runtime/claude/tool-hook.json"),
      );

      expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(harness.requestCount()).toBe(1);
    } finally {
      await harness.close();
    }
  });
});

describe("Claude adapter session lifecycle", () => {
  it.each([
    { method: "start" as const, eventKind: "session_started" as const },
    { method: "resume" as const, eventKind: "session_resumed" as const },
  ])(
    "$method returns before init and binds init during the first turn",
    async ({ method, eventKind }) => {
      const harness = await startClaudeAdapterHarness({
        command: path.resolve(
          "tests/fixtures/runtime/claude/lazy-init-cli.mjs",
        ),
      });
      const runId = newRunId();
      try {
        const request = {
          laneId: harness.laneId,
          cwd: process.cwd(),
        };
        const session =
          method === "start"
            ? await harness.adapter.start(request)
            : await harness.adapter.resume({
                ...request,
                nativeSessionId: sessionId,
              });
        const run = await harness.adapter.sendTurn({
          runId,
          laneId: harness.laneId,
          nativeSessionId: session.nativeSessionId,
          input: "exercise lazy init",
        });
        const events = [];
        for await (const event of run.events) events.push(event);

        expect(events.map((event) => event.kind).slice(0, 2)).toEqual([
          "tool_call_updated",
          eventKind,
        ]);
        expect(
          events.find((event) => event.kind === eventKind)?.payload
            .nativeSessionId,
        ).toBe(session.nativeSessionId);
      } finally {
        await harness.adapter.cancel(runId);
        await harness.close();
      }
    },
  );
});
