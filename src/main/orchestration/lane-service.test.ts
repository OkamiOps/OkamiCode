import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createGatewayProfile } from "../gateway/profile";
import { createLaneHarness } from "./test-harness";

const chatGptProfile = createGatewayProfile({
  id: "chatgpt-lane",
  provider: "chatgpt",
  kind: "bridged",
  env: { CODEX_HOME: "/tmp/okami-codex" },
  displayQuotaAccount: "ChatGPT Plus",
});

describe("LaneService", () => {
  it("lists honest lane projections without opening native sessions", () => {
    const h = createLaneHarness({
      runtime: "codex",
      nativeSession: "thread-123456789",
      events: [1, 2],
      gateway: {
        port: 43123,
        bearerToken: "gateway-session-token",
        accounts: [
          {
            provider: "chatgpt",
            bridgedProfile: chatGptProfile,
            nativeRuntime: "codex",
          },
        ],
      },
    });

    expect(h.service.list(h.fx.taskId)).toEqual([
      expect.objectContaining({
        laneId: h.fx.laneId,
        taskId: h.fx.taskId,
        harness: "claude",
        runtimeKind: "claude",
        providerAccountLabel: "ChatGPT",
        model: "gpt-test",
        routeKind: "bridged",
        displayQuotaAccount: "ChatGPT Plus",
        // Lanes report the mode the CLI will actually be spawned with.
        permissionMode: "manual",
        workspacePath: null,
        nativeSessionIdPrefix: "thread-1…",
        status: "ready",
        temperature: "stale",
        pendingDeltaEvents: 2,
      }),
    ]);
    expect(h.runtimes.claude.startCalls).toBe(0);
    expect(h.runtimes.codex.startCalls).toBe(0);
  });

  it("launches a GPT lane on the Claude harness with gateway env", async () => {
    const h = createLaneHarness({
      runtime: "codex",
      gateway: {
        port: 43123,
        bearerToken: "gateway-session-token",
        accounts: [
          {
            provider: "chatgpt",
            bridgedProfile: chatGptProfile,
            nativeRuntime: "codex",
          },
        ],
      },
    });

    try {
      const opened = await h.openExisting();

      expect(opened).toMatchObject({
        routeKind: "bridged",
        routeReason: "subscription_bridge",
        displayQuotaAccount: "ChatGPT Plus",
      });
      expect(h.runtimes.claude.startRequests).toHaveLength(1);
      expect(h.runtimes.codex.startRequests).toHaveLength(0);
      expect(h.runtimes.claude.startRequests[0]?.env).toMatchObject({
        ANTHROPIC_BASE_URL: "http://127.0.0.1:43123/chatgpt-lane",
      });
      // The bearer carries the lane id as a suffix so the gateway can resolve
      // per-lane options such as reasoning effort.
      expect(
        h.runtimes.claude.startRequests[0]?.env?.ANTHROPIC_AUTH_TOKEN,
      ).toMatch(/^gateway-session-token\.[0-9a-f-]{36}$/u);
      expect(
        h.runtimes.claude.startRequests[0]?.env?.ANTHROPIC_API_KEY,
      ).toBeUndefined();
    } finally {
      await removeGatewayConfigDirectory(
        h.runtimes.claude.startRequests[0]?.env,
      );
    }
  });

  it("launches the native adapter unchanged when the bridge is unhealthy", async () => {
    const h = createLaneHarness({
      runtime: "codex",
      gateway: {
        port: 43123,
        bearerToken: "gateway-session-token",
        health: { chatgpt: "unhealthy" },
        accounts: [
          {
            provider: "chatgpt",
            bridgedProfile: chatGptProfile,
            nativeRuntime: "codex",
          },
        ],
      },
    });

    const opened = await h.openExisting();

    expect(opened).toMatchObject({
      routeKind: "native",
      routeReason: "bridge_unhealthy",
      displayQuotaAccount: "ChatGPT Plus",
    });
    expect(h.runtimes.codex.startRequests).toHaveLength(1);
    expect(h.runtimes.codex.startRequests[0]?.env).toBeUndefined();
    expect(h.runtimes.claude.startRequests).toHaveLength(0);
  });

  it("keeps Cursor native even when its selected model is Claude", async () => {
    const h = createLaneHarness({
      runtime: "cursor",
      model: "claude-sonnet-4-6",
      gateway: {
        port: 43123,
        bearerToken: "gateway-session-token",
        accounts: [
          {
            provider: "chatgpt",
            bridgedProfile: chatGptProfile,
            nativeRuntime: "codex",
          },
        ],
      },
    });

    const opened = await h.openExisting();

    expect(opened).toMatchObject({
      harness: "native",
      runtimeKind: "cursor",
      providerAccountLabel: "Cursor",
      routeKind: "native",
      routeReason: "native_requested",
      displayQuotaAccount: "Cursor subscription",
    });
    expect(h.runtimes.cursor.startRequests).toHaveLength(1);
    expect(h.runtimes.cursor.startRequests[0]?.env).toBeUndefined();
    expect(h.runtimes.claude.startRequests).toHaveLength(0);
    expect(h.runtimes.codex.startRequests).toHaveLength(0);
  });

  it("records the resolved route and quota account for every turn", async () => {
    const h = createLaneHarness({
      runtime: "codex",
      gateway: {
        port: 43123,
        bearerToken: "gateway-session-token",
        accounts: [
          {
            provider: "chatgpt",
            bridgedProfile: chatGptProfile,
            nativeRuntime: "codex",
          },
        ],
      },
    });
    try {
      const opened = await h.openExisting();
      const run = await h.service.sendTurn(opened, "hello");

      expect(h.runtimes.claude.sentTurns).toHaveLength(1);
      expect(h.runtimes.codex.sentTurns).toHaveLength(0);

      const audit = h.fx.db
        .prepare(
          `SELECT run_id, action, metadata_json
           FROM audit_entries WHERE action = 'lane_route_resolved'`,
        )
        .get() as
        { run_id: string; action: string; metadata_json: string } | undefined;
      expect(audit).toEqual({
        run_id: run.runId,
        action: "lane_route_resolved",
        metadata_json: JSON.stringify({
          harness: "claude",
          routeKind: "bridged",
          routeReason: "subscription_bridge",
          displayQuotaAccount: "ChatGPT Plus",
        }),
      });
    } finally {
      await removeGatewayConfigDirectory(
        h.runtimes.claude.startRequests[0]?.env,
      );
    }
  });

  it("resumes a hot lane without bootstrap", async () => {
    const h = createLaneHarness({
      runtime: "codex",
      nativeSession: "thread-123",
    });
    const opened = await h.openExisting();
    expect(opened.nativeSessionId).toBe("thread-123");
    expect(opened.delta).toBeNull();
    expect(opened.temperature).toBe("hot");
    expect(h.fakeRuntime.resumeCalls).toBe(1);
    expect(h.fakeRuntime.startCalls).toBe(0);
  });

  it("sends only events after the cursor to a stale lane", () => {
    const h = createLaneHarness({
      cursor: 4,
      events: [1, 2, 3, 4, 5, 6, 7],
    });
    const delta = h.buildDelta();
    expect(delta.fromSequenceExclusive).toBe(4);
    expect(delta.events.map((event) => event.sequence)).toEqual([5, 6, 7]);
  });

  it("classifies stale, cold, and clean lanes", async () => {
    const stale = createLaneHarness({
      nativeSession: "session-stale",
      events: [1],
    });
    expect((await stale.openExisting()).temperature).toBe("stale");

    const cold = createLaneHarness();
    const coldOpened = await cold.openExisting();
    expect(coldOpened.temperature).toBe("cold");
    expect(coldOpened.delta).not.toBeNull();
    expect(cold.fakeRuntime.startCalls).toBe(1);

    const clean = createLaneHarness();
    const cleanOpened = await clean.service.open(clean.fx.laneId, {
      inheritTask: false,
    });
    expect(cleanOpened.temperature).toBe("clean");
    expect(cleanOpened.delta).toBeNull();
  });

  it("adds zero bootstrap bytes to a hot lane turn", async () => {
    const h = createLaneHarness({ nativeSession: "session-hot" });
    const opened = await h.openExisting();
    await h.service.sendTurn(opened, "continue");
    expect(h.fakeRuntime.sentTurns[0]?.input).toBe("continue");
  });

  it("builds the exact canonical delta from persisted projections only", () => {
    const h = createLaneHarness({ cursor: 1 });
    const task = h.fx.tasks.findById(h.fx.taskId);
    if (!task) throw new Error("Missing task fixture");
    h.fx.tasks.update(
      {
        ...task,
        objective: "Ship deterministic lanes",
        updatedAt: new Date(Date.parse(task.updatedAt) + 1).toISOString(),
      },
      task.updatedAt,
    );
    h.appendEvent(1, {
      constraints: ["No auxiliary model"],
      decisions: ["Resume native sessions"],
      git: { branch: "feature/lanes", dirtyFiles: ["src/lane.ts"] },
    });
    h.appendEvent(2, { summary: "accepted work" });
    h.addArtifact("file:///tmp/result.txt");

    expect(h.buildDelta()).toEqual({
      schemaVersion: 1,
      taskId: h.fx.taskId,
      fromSequenceExclusive: 1,
      toSequenceInclusive: 2,
      objective: "Ship deterministic lanes",
      constraints: ["No auxiliary model"],
      decisions: ["Resume native sessions"],
      git: { branch: "feature/lanes", dirtyFiles: ["src/lane.ts"] },
      artifacts: ["file:///tmp/result.txt"],
      events: [
        {
          sequence: 2,
          kind: "message_completed",
          summary: "accepted work",
        },
      ],
    });
    expect(h.fakeRuntime.startCalls).toBe(0);
    expect(h.fakeRuntime.resumeCalls).toBe(0);
    expect(h.fakeRuntime.sendTurnCalls).toBe(0);
  });

  it("advances the cursor only after the runtime accepts the delta", async () => {
    const h = createLaneHarness({ events: [1, 2] });
    const opened = await h.openExisting();
    expect(h.fx.lanes.findById(h.fx.laneId)?.lastEventCursor).toBe(0);

    h.fakeRuntime.rejectNextTurn = true;
    await expect(h.service.sendTurn(opened, "continue")).rejects.toThrow(
      "runtime rejected delta",
    );
    expect(h.fx.lanes.findById(h.fx.laneId)?.lastEventCursor).toBe(0);
    const failed = h.fx.db
      .prepare(
        `SELECT status, finished_at, error_json FROM runs
         WHERE lane_id = ? AND id <> ? ORDER BY started_at DESC LIMIT 1`,
      )
      .get(h.fx.laneId, h.fx.runId) as {
      status: string;
      finished_at: string | null;
      error_json: string | null;
    };
    expect(failed).toMatchObject({
      status: "failed",
      finished_at: expect.any(String),
    });
    expect(JSON.parse(failed.error_json ?? "{}")).toEqual({
      name: "Error",
      message: "runtime rejected delta",
    });

    await h.service.sendTurn(opened, "continue");
    expect(h.fx.lanes.findById(h.fx.laneId)?.lastEventCursor).toBe(2);
  });

  it("switches lanes with an audit record and leaves the source open", async () => {
    const h = createLaneHarness({ nativeSession: "source-session" });
    const targetLaneId = h.addLane({ nativeSession: "target-session" });
    const sourceBefore = h.fx.lanes.findById(h.fx.laneId);

    const opened = await h.service.switch(h.fx.laneId, targetLaneId);

    expect(opened.nativeSessionId).toBe("target-session");
    expect(h.fx.lanes.findById(h.fx.laneId)?.status).toBe(sourceBefore?.status);
    const audit = h.fx.db
      .prepare(
        `SELECT action, lane_id, metadata_json
         FROM audit_entries WHERE action = 'lane_switched'`,
      )
      .get() as
      { action: string; lane_id: string; metadata_json: string } | undefined;
    expect(audit).toEqual({
      action: "lane_switched",
      lane_id: targetLaneId,
      metadata_json: JSON.stringify({
        sourceLaneId: h.fx.laneId,
        targetLaneId,
      }),
    });
  });
});

async function removeGatewayConfigDirectory(
  environment: NodeJS.ProcessEnv | undefined,
): Promise<void> {
  const directory = environment?.CLAUDE_CONFIG_DIR;
  if (directory) await rm(directory, { recursive: true, force: true });
}
