import { describe, expect, it } from "vitest";
import { createGatewayProfile } from "../gateway/profile";
import type { RuntimeTransport } from "../runtime/manifest";
import { ProviderRuntimeAdapter } from "../runtime/sdk/provider-runtime";
import { createLaneHarness, FakeRuntimeAdapter } from "./test-harness";

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
        harness: "native",
        runtimeKind: "codex",
        providerAccountLabel: "ChatGPT",
        model: "gpt-test",
        routeKind: "native",
        displayQuotaAccount: "OpenAI / Codex transport",
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

  it("keeps a GPT lane on the Okami provider runtime even when a legacy bridge is configured", async () => {
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

    const opened = await h.openExisting();

    expect(opened).toMatchObject({
      harness: "native",
      runtimeKind: "codex",
      routeKind: "native",
      routeReason: "native_requested",
      displayQuotaAccount: "OpenAI / Codex transport",
    });
    expect(h.runtimes.codex.startRequests).toHaveLength(1);
    expect(h.runtimes.codex.startRequests[0]?.env).toBeUndefined();
    expect(h.runtimes.claude.startRequests).toHaveLength(0);
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
      routeReason: "native_requested",
      displayQuotaAccount: "OpenAI / Codex transport",
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
    const opened = await h.openExisting();
    const run = await h.service.sendTurn(opened, "hello");

    expect(h.runtimes.claude.sentTurns).toHaveLength(0);
    expect(h.runtimes.codex.sentTurns).toHaveLength(1);

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
        harness: "native",
        routeKind: "native",
        routeReason: "native_requested",
        displayQuotaAccount: "OpenAI / Codex transport",
      }),
    });
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

  it("does not persist a deferred session before its authoritative event", async () => {
    const h = createLaneHarness({ deferredStart: true });

    const opened = await h.openExisting();

    expect(opened.nativeSessionId).toBeNull();
    expect(h.fx.lanes.findNativeSessionBinding(h.fx.laneId)).toBeUndefined();
  });

  it("does not overwrite an existing authoritative binding while opening", async () => {
    const h = createLaneHarness({ nativeSession: "first-authoritative-id" });
    h.fakeRuntime.resume = async (request) => ({
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId: "different-authoritative-id",
      runtimeVersion: "fake-2",
    });

    await expect(h.openExisting()).rejects.toThrow(
      "Native session binding conflict",
    );
    expect(h.fx.lanes.findNativeSessionBinding(h.fx.laneId)).toEqual(
      expect.objectContaining({ nativeSessionId: "first-authoritative-id" }),
    );
  });

  it("adds zero bootstrap bytes to a hot lane turn", async () => {
    const h = createLaneHarness({ nativeSession: "session-hot" });
    const opened = await h.openExisting();
    await h.service.sendTurn(opened, "continue");
    expect(h.fakeRuntime.sentTurns[0]?.input).toBe("continue");
  });

  it("gives a cold provider the shared task conversation from sibling lanes", async () => {
    const h = createLaneHarness();
    const siblingLaneId = h.addLane({ nativeSession: "sibling-session" });
    const conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    h.fx.db
      .prepare(
        `INSERT INTO conversations (id, task_id, kind, created_at, updated_at)
         VALUES (?, ?, 'workbench', ?, ?)`,
      )
      .run(conversationId, h.fx.taskId, now, now);
    const insert = h.fx.db.prepare(
      `INSERT INTO messages
       (id, conversation_id, sequence, role, content_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      crypto.randomUUID(),
      conversationId,
      1,
      "user",
      JSON.stringify({
        body: "Corrija o deploy sem perder as tarefas",
        laneId: siblingLaneId,
      }),
      now,
    );
    insert.run(
      crypto.randomUUID(),
      conversationId,
      2,
      "assistant",
      JSON.stringify({
        body: "O deploy foi corrigido e as tarefas foram preservadas.",
        laneId: siblingLaneId,
        providerLabel: "Claude",
        model: "Opus",
      }),
      now,
    );

    const opened = await h.openExisting();
    await h.service.sendTurn(opened, "ta por ai?");

    expect(h.fakeRuntime.sentTurns[0]?.input).toContain(
      "Corrija o deploy sem perder as tarefas",
    );
    expect(h.fakeRuntime.sentTurns[0]?.input).toContain(
      "O deploy foi corrigido e as tarefas foram preservadas.",
    );
    expect(h.fakeRuntime.sentTurns[0]?.input).toContain("ta por ai?");
  });

  it("sends new sibling context to a hot provider once without replaying it", async () => {
    const h = createLaneHarness({ nativeSession: "target-session" });
    const siblingLaneId = h.addLane({ nativeSession: "sibling-session" });
    const conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    h.fx.db
      .prepare(
        `INSERT INTO conversations (id, task_id, kind, created_at, updated_at)
         VALUES (?, ?, 'workbench', ?, ?)`,
      )
      .run(conversationId, h.fx.taskId, now, now);
    const insert = h.fx.db.prepare(
      `INSERT INTO messages
       (id, conversation_id, sequence, role, content_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      crypto.randomUUID(),
      conversationId,
      1,
      "user",
      JSON.stringify({
        body: "Primeira decisão compartilhada",
        laneId: siblingLaneId,
      }),
      now,
    );

    const opened = await h.openExisting();
    await h.service.sendTurn(opened, "continue");
    await h.service.sendTurn(opened, "continue de novo");

    expect(h.fakeRuntime.sentTurns[0]?.input).toContain(
      "Primeira decisão compartilhada",
    );
    expect(h.fakeRuntime.sentTurns[1]?.input).toBe("continue de novo");

    insert.run(
      crypto.randomUUID(),
      conversationId,
      2,
      "assistant",
      JSON.stringify({
        body: "Novo resultado do provider irmão",
        laneId: siblingLaneId,
        providerLabel: "Claude",
        model: "Opus",
      }),
      new Date(Date.parse(now) + 1).toISOString(),
    );
    await h.service.sendTurn(opened, "e agora?");

    expect(h.fakeRuntime.sentTurns[2]?.input).toContain(
      "Novo resultado do provider irmão",
    );
    expect(h.fakeRuntime.sentTurns[2]?.input).not.toContain(
      "Primeira decisão compartilhada",
    );
  });

  it("hands sanitized operational context to a sibling lane exactly once", async () => {
    const h = createLaneHarness({ nativeSession: "target-session" });
    const siblingLaneId = h.addLane({ nativeSession: "sibling-session" });
    const conversationId = crypto.randomUUID();
    const now = new Date().toISOString();
    h.fx.db
      .prepare(
        `INSERT INTO conversations (id, task_id, kind, created_at, updated_at)
         VALUES (?, ?, 'workbench', ?, ?)`,
      )
      .run(conversationId, h.fx.taskId, now, now);
    h.fx.db
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, sequence, role, content_json, created_at)
         VALUES (?, ?, 1, 'context', ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        conversationId,
        JSON.stringify({
          body: "Arquivos alterados: src/a.ts",
          laneId: siblingLaneId,
          contextKind: "tool_call_completed",
        }),
        now,
      );

    const opened = await h.openExisting();
    await h.service.sendTurn(opened, "revise o resultado");
    await h.service.sendTurn(opened, "continue");

    expect(h.fakeRuntime.sentTurns[0]?.input).toContain(
      "Arquivos alterados: src/a.ts",
    );
    expect(h.fakeRuntime.sentTurns[1]?.input).toBe("continue");
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
      conversationCursors: [],
      conversation: [],
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

  it("reuses an opened lane for consecutive turns after its delta is accepted", async () => {
    const h = createLaneHarness({ events: [1, 2] });
    const opened = await h.openExisting();

    await h.service.sendTurn(opened, "first");
    await expect(h.service.sendTurn(opened, "second")).resolves.toBeDefined();

    expect(h.fakeRuntime.sentTurns.map((turn) => turn.input)).toEqual([
      expect.stringContaining("first"),
      "second",
    ]);
  });

  it.each([
    ["mimo", "mimo-cli", "mimo-token-plan"],
    ["minimax", "minimax-cli", "minimax-token-plan"],
  ] as const)(
    "cold-rehydrates fully advanced %s history once after CLI migration",
    async (runtimeKind, retiredTransport, tokenPlanTransport) => {
      const tokenPlan = new FakeRuntimeAdapter(runtimeKind);
      const runtime = new ProviderRuntimeAdapter(runtimeKind, [
        {
          descriptor: tokenPlanDescriptor(tokenPlanTransport),
          adapter: tokenPlan,
        },
      ]);
      const oldBinding = `okami:v1:${retiredTransport}:${Buffer.from(
        "retired-native-session",
      ).toString("base64url")}`;
      const h = createLaneHarness({
        runtime: runtimeKind,
        nativeSession: oldBinding,
        cursor: 2,
        events: [1, 2],
        runtimeAdapter: runtime,
      });
      const conversationId = crypto.randomUUID();
      const now = new Date().toISOString();
      h.fx.db
        .prepare(
          `INSERT INTO conversations (id, task_id, kind, created_at, updated_at)
           VALUES (?, ?, 'workbench', ?, ?)`,
        )
        .run(conversationId, h.fx.taskId, now, now);
      const insert = h.fx.db.prepare(
        `INSERT INTO messages
         (id, conversation_id, sequence, role, content_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        crypto.randomUUID(),
        conversationId,
        1,
        "user",
        JSON.stringify({
          body: "Contexto histórico do usuário já consumido",
          laneId: h.fx.laneId,
        }),
        now,
      );
      insert.run(
        crypto.randomUUID(),
        conversationId,
        2,
        "assistant",
        JSON.stringify({
          body: "Resposta histórica do assistente já consumida",
          laneId: h.fx.laneId,
          providerLabel: runtimeKind,
          model: "legacy-model",
        }),
        new Date(Date.parse(now) + 1).toISOString(),
      );
      h.fx.db
        .prepare(
          `INSERT INTO event_cursors
           (lane_id, source_lane_id, last_sequence, updated_at)
           VALUES (?, ?, 2, ?)`,
        )
        .run(h.fx.laneId, h.fx.laneId, now);

      const opened = await h.openExisting();

      expect(opened).toMatchObject({
        temperature: "cold",
        rehydrationRequired: true,
      });
      expect(tokenPlan.startRequests).toHaveLength(1);
      expect(tokenPlan.resumeRequests).toHaveLength(0);
      expect(h.fx.lanes.findNativeSessionBinding(h.fx.laneId)).toMatchObject({
        nativeSessionId: opened.nativeSessionId,
        migrationFromNativeSessionId: oldBinding,
        rehydrationRequired: true,
      });

      await h.service.sendTurn(opened, "primeiro turno novo");

      expect(tokenPlan.sentTurns[0]?.input).toContain(
        "Contexto histórico do usuário já consumido",
      );
      expect(tokenPlan.sentTurns[0]?.input).toContain(
        "Resposta histórica do assistente já consumida",
      );
      expect(tokenPlan.sentTurns[0]?.input).toContain("primeiro turno novo");
      expect(h.fx.lanes.findNativeSessionBinding(h.fx.laneId)).toMatchObject({
        rehydrationRequired: false,
      });

      await h.service.sendTurn(opened, "segundo turno novo");

      expect(tokenPlan.sentTurns[1]?.input).toBe("segundo turno novo");
    },
  );

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

function tokenPlanDescriptor(id: string): RuntimeTransport {
  return {
    id,
    kind: "api",
    authentication: "okami_vault",
    entitlement: "token_plan",
    priority: 10,
    optional: true,
    protocolVersion:
      id === "mimo-token-plan" ? "responses-v1" : "chat-completions-v1",
    executable: null,
    legacySessionOwner: true,
  };
}
