import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { RunId } from "../../shared/ids";
import { createTestDatabase } from "../db/test-support";
import type { RunHandle } from "../runtime/adapter";
import type { LaneService, OpenedLane } from "./lane-service";
import { QuickChatService } from "./quick-chat";

function createQuickChatHarness(
  laneService?: Pick<LaneService, "open" | "sendTurn">,
  memory?: { resolveContextRefs(refs: string[]): string },
) {
  const fx = createTestDatabase();
  const service = new QuickChatService({
    db: fx.db,
    tasks: fx.tasks,
    lanes: fx.lanes,
    audit: fx.audit,
    laneService,
    memory,
    createId: randomUUID,
    clock: () => new Date("2026-07-18T12:00:00.000Z"),
  });

  return {
    fx,
    service,
    create: (runtime: "claude" | "codex") => service.create(runtime),
    selectContext: (chatId: string, contextRefs: string[]) =>
      service.selectContext(chatId, contextRefs),
    buildTurn: (chatId: string, input: string) =>
      service.buildTurn(chatId, input),
  };
}

describe("QuickChatService", () => {
  it("has no workspace and sends only selected context", async () => {
    const h = createQuickChatHarness();
    const chat = await h.create("codex");

    expect(chat.workspaceId).toBeNull();
    expect(h.fx.tasks.findById(chat.taskId)?.kind).toBe("quick_chat");
    expect(h.fx.lanes.findById(chat.laneId)).toMatchObject({
      runtimeKind: "codex",
      taskId: chat.taskId,
      workspacePath: null,
    });

    await h.selectContext(chat.id, ["memory:note-7"]);
    const turn = await h.buildTurn(chat.id, "Resuma isso");

    expect(turn.contextRefs).toEqual(["memory:note-7"]);
    expect(JSON.stringify(turn)).not.toContain("memory:note-8");
  });

  it("rejects a quick chat whose lane unexpectedly has a workspace", async () => {
    const h = createQuickChatHarness();
    const chat = await h.create("claude");
    const lane = h.fx.lanes.findById(chat.laneId);
    if (!lane) throw new Error("Lane do chat ausente");
    h.fx.lanes.update(
      {
        ...lane,
        workspacePath: "/workspace/nao-permitido",
        updatedAt: "2026-07-18T12:00:01.000Z",
      },
      lane.updatedAt,
    );

    expect(() => h.buildTurn(chat.id, "Continue")).toThrow(
      "Quick chat não pode ter workspace",
    );
  });

  it("starts the selected lane outside the project working directory", async () => {
    const openOptions: unknown[] = [];
    const laneService = {
      async open(laneId: string, options: unknown) {
        openOptions.push(options);
        return openedLane(laneId);
      },
      async sendTurn(): Promise<RunHandle> {
        return {
          runId: randomUUID() as RunId,
          events: emptyEvents(),
        };
      },
    } as Pick<LaneService, "open" | "sendTurn">;
    const h = createQuickChatHarness(laneService);
    const chat = h.create("codex");

    await h.service.send(chat.id, "Sem projeto", []);

    expect(openOptions).toEqual([
      { inheritTask: false, workspaceFallbackPath: tmpdir() },
    ]);
  });

  it("injects only resolved memory inside a visible delimiter", async () => {
    let runtimeInput = "";
    const laneService = {
      async open(laneId: string) {
        return openedLane(laneId);
      },
      async sendTurn(_lane: OpenedLane, input: string): Promise<RunHandle> {
        runtimeInput = input;
        return { runId: randomUUID() as RunId, events: emptyEvents() };
      },
    } as Pick<LaneService, "open" | "sendTurn">;
    const h = createQuickChatHarness(laneService, {
      resolveContextRefs: (refs) =>
        refs.includes("memory:7")
          ? "--- OKAMI MEMORY: note.md ---\nContexto permitido\n--- END OKAMI MEMORY ---"
          : "",
    });
    const chat = h.create("claude");

    await h.service.send(chat.id, "Resuma", ["memory:7"]);

    expect(runtimeInput).toContain("--- OKAMI MEMORY: note.md ---");
    expect(runtimeInput).toContain("--- END OKAMI MEMORY ---");
    expect(runtimeInput).toContain("--- OKAMI QUICK CHAT ---");
    expect(runtimeInput).toContain('"contextRefs":["memory:7"]');
  });

  it("validates memory before recording context or opening a lane", async () => {
    let opened = 0;
    const laneService = {
      async open() {
        opened += 1;
        return openedLane(randomUUID());
      },
      async sendTurn(): Promise<RunHandle> {
        return { runId: randomUUID() as RunId, events: emptyEvents() };
      },
    } as Pick<LaneService, "open" | "sendTurn">;
    const h = createQuickChatHarness(laneService, {
      resolveContextRefs: () => {
        throw new Error("Referência de memória não autorizada");
      },
    });
    const chat = h.create("codex");

    await expect(
      h.service.send(chat.id, "Resuma", ["memory:999"]),
    ).rejects.toThrow(/não autorizada/iu);
    expect(opened).toBe(0);
    expect(
      h.fx.db
        .prepare(
          "SELECT count(*) AS count FROM messages WHERE conversation_id = ?",
        )
        .get(chat.id),
    ).toEqual({ count: 0 });
  });

  it("promotes only selected messages and context with source audit", async () => {
    const h = createQuickChatHarness();
    const chat = await h.create("codex");
    const selected = h.service.appendMessage(chat.id, "user", "Leve isto");
    const omitted = h.service.appendMessage(chat.id, "assistant", "Não leve");
    h.service.selectContext(chat.id, ["memory:note-7", "memory:note-8"]);

    const promoted = h.service.promote({
      chatId: chat.id,
      title: "Tarefa promovida",
      objective: "Continuar apenas com a seleção",
      selectedMessageIds: [selected.id],
      contextRefs: ["memory:note-7"],
    });

    expect(h.fx.tasks.findById(promoted.task.id)?.kind).toBe("workbench");
    const copied = h.fx.db
      .prepare(
        `SELECT role, content_json
         FROM messages WHERE conversation_id = ? ORDER BY sequence`,
      )
      .all(promoted.conversationId) as Array<{
      role: string;
      content_json: string;
    }>;
    expect(JSON.stringify(copied)).toContain("Leve isto");
    expect(JSON.stringify(copied)).not.toContain(omitted.id);
    expect(JSON.stringify(copied)).not.toContain("Não leve");
    expect(promoted.contextRefs).toEqual(["memory:note-7"]);
    expect(JSON.stringify(promoted)).not.toContain("memory:note-8");

    const audit = h.fx.db
      .prepare(
        `SELECT action, metadata_json
         FROM audit_entries WHERE action = 'quick_chat_promoted'`,
      )
      .get() as { action: string; metadata_json: string } | undefined;
    expect(audit?.action).toBe("quick_chat_promoted");
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toMatchObject({
      sourceConversationId: chat.id,
      selectedMessageIds: [selected.id],
      contextRefs: ["memory:note-7"],
    });
  });
});

function openedLane(laneId: string): OpenedLane {
  return {
    laneId,
    taskId: randomUUID(),
    nativeSessionId: randomUUID(),
    nativeSessionIdPrefix: "session…",
    bindingState: "authoritative",
    runtimeVersion: "fake-1",
    temperature: "clean",
    delta: null,
    pendingDeltaEvents: 0,
    harness: "native",
    runtimeKind: "codex",
    providerAccountLabel: "ChatGPT",
    model: "gpt-test",
    routeKind: "native",
    routeReason: "native_requested",
    displayQuotaAccount: "ChatGPT subscription",
    permissionMode: null,
    workspacePath: null,
    status: "ready",
  };
}

async function* emptyEvents() {}
