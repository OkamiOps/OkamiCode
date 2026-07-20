import { tmpdir } from "node:os";
import type { RuntimeKind } from "../../shared/contracts/lane";
import type { Database } from "../db/connection";
import type { AuditRepository } from "../db/repositories/audit";
import type { LaneRepository } from "../db/repositories/lanes";
import type { RunHandle } from "../runtime/adapter";
import type { TaskRecord, TaskRepository } from "../db/repositories/tasks";
import type { LaneService } from "./lane-service";

interface QuickChatDependencies {
  db: Database;
  tasks: Pick<TaskRepository, "findById" | "insert">;
  lanes: Pick<LaneRepository, "findById" | "insert" | "update">;
  audit: Pick<AuditRepository, "record">;
  laneService?: Pick<LaneService, "open" | "sendTurn">;
  memory?: Pick<MemoryContextResolver, "resolveContextRefs">;
  createId: () => string;
  clock?: () => Date;
}

export interface MemoryContextResolver {
  resolveContextRefs(refs: string[]): string;
}

export interface QuickChatConversation {
  id: string;
  taskId: string;
  laneId: string;
  runtime: RuntimeKind;
  workspaceId: null;
  createdAt: string;
}

export interface QuickChatMessageRecord {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  body: string;
  createdAt: string;
}

export interface QuickChatTurn {
  chatId: string;
  input: string;
  contextRefs: string[];
}

export interface PromotedQuickChat {
  task: TaskRecord;
  conversationId: string;
  sourceConversationId: string;
  copiedMessageIds: string[];
  contextRefs: string[];
}

export class QuickChatService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: QuickChatDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  create(runtime: RuntimeKind): QuickChatConversation {
    const now = this.clock().toISOString();
    const taskId = this.dependencies.createId();
    const chatId = this.dependencies.createId();
    const laneId = this.dependencies.createId();
    const createRecords = this.dependencies.db.transaction(() => {
      this.dependencies.tasks.insert({
        id: taskId,
        kind: "quick_chat",
        title: "Chat rápido",
        objective: "Conversa independente sem workspace",
        status: "active",
        workspacePath: null,
        createdAt: now,
        updatedAt: now,
      });
      this.dependencies.db
        .prepare(
          `INSERT INTO conversations
           (id, task_id, kind, created_at, updated_at)
           VALUES (?, ?, 'quick_chat', ?, ?)`,
        )
        .run(chatId, taskId, now, now);
      this.dependencies.lanes.insert({
        id: laneId,
        taskId,
        runtimeKind: runtime,
        providerKind: runtime === "codex" ? "chatgpt" : "claude_max",
        model: runtime === "codex" ? "gpt-5.6" : "claude-sonnet-4-6",
        status: "ready",
        workspacePath: null,
        lastEventCursor: 0,
        createdAt: now,
        updatedAt: now,
      });
    });
    createRecords();
    return {
      id: chatId,
      taskId,
      laneId,
      runtime,
      workspaceId: null,
      createdAt: now,
    };
  }

  selectContext(chatId: string, contextRefs: string[]): void {
    this.requireQuickChat(chatId);
    this.insertMessage(chatId, "context_selection", {
      contextRefs: unique(contextRefs),
    });
  }

  buildTurn(chatId: string, input: string): QuickChatTurn {
    const chat = this.requireQuickChat(chatId);
    if (chat.workspacePath !== null) {
      throw new Error("Quick chat não pode ter workspace");
    }
    return {
      chatId,
      input,
      contextRefs: this.selectedContext(chatId),
    };
  }

  appendMessage(
    chatId: string,
    role: "user" | "assistant",
    body: string,
  ): QuickChatMessageRecord {
    this.requireQuickChat(chatId);
    const inserted = this.insertMessage(chatId, role, { body });
    return { ...inserted, chatId, role, body };
  }

  async send(
    chatId: string,
    input: string,
    contextRefs: string[],
  ): Promise<{ laneId: string; messageId: string; run: RunHandle }> {
    const laneService = this.dependencies.laneService;
    if (!laneService)
      throw new Error("Lane service indisponível para quick chat");
    const selectedRefs = unique(contextRefs);
    const memoryContext =
      this.dependencies.memory?.resolveContextRefs(selectedRefs);
    if (
      selectedRefs.some((ref) => ref.startsWith("memory:")) &&
      memoryContext === undefined
    ) {
      throw new Error("Memória indisponível para quick chat");
    }
    this.selectContext(chatId, selectedRefs);
    const turn = this.buildTurn(chatId, input);
    const chat = this.requireQuickChat(chatId);
    const message = this.appendMessage(chatId, "user", input);
    const opened = await laneService.open(chat.laneId, {
      inheritTask: false,
      workspaceFallbackPath: tmpdir(),
    });
    const runtimeInput = memoryContext
      ? `${memoryContext}\n\n--- OKAMI QUICK CHAT ---\n${JSON.stringify(turn)}`
      : JSON.stringify(turn);
    const run = await laneService.sendTurn(opened, runtimeInput);
    return { laneId: chat.laneId, messageId: message.id, run };
  }

  promote(request: {
    chatId: string;
    title: string;
    objective: string;
    selectedMessageIds: string[];
    contextRefs: string[];
  }): PromotedQuickChat {
    const source = this.requireQuickChat(request.chatId);
    const selectedMessageIds = unique(request.selectedMessageIds);
    const contextRefs = unique(request.contextRefs);
    const activeContext = new Set(this.selectedContext(request.chatId));
    if (contextRefs.some((ref) => !activeContext.has(ref))) {
      throw new Error("A promoção contém contexto não selecionado no chat");
    }
    const messages = this.selectedMessages(request.chatId, selectedMessageIds);
    if (messages.length !== selectedMessageIds.length) {
      throw new Error("A promoção contém mensagens fora do chat");
    }

    const now = this.clock().toISOString();
    const task: TaskRecord = {
      id: this.dependencies.createId(),
      kind: "workbench",
      title: request.title,
      objective: request.objective,
      status: "active",
      workspacePath: null,
      createdAt: now,
      updatedAt: now,
    };
    const conversationId = this.dependencies.createId();
    const laneId = this.dependencies.createId();
    const promoteRecords = this.dependencies.db.transaction(() => {
      this.dependencies.tasks.insert(task);
      this.dependencies.db
        .prepare(
          `INSERT INTO conversations
           (id, task_id, kind, created_at, updated_at)
           VALUES (?, ?, 'workbench', ?, ?)`,
        )
        .run(conversationId, task.id, now, now);
      this.dependencies.lanes.insert({
        id: laneId,
        taskId: task.id,
        runtimeKind: source.runtimeKind,
        providerKind: source.providerKind,
        model: source.model,
        status: "ready",
        workspacePath: null,
        lastEventCursor: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (const message of messages) {
        this.insertMessage(conversationId, message.role, message.content);
      }
      if (contextRefs.length > 0) {
        this.insertMessage(conversationId, "context_selection", {
          contextRefs,
        });
      }
      this.dependencies.audit.record({
        id: this.dependencies.createId(),
        taskId: task.id,
        laneId,
        runId: null,
        actor: "core",
        action: "quick_chat_promoted",
        decision: null,
        capability: null,
        resource: null,
        metadata: {
          sourceConversationId: request.chatId,
          selectedMessageIds,
          contextRefs,
        },
        occurredAt: now,
      });
    });
    promoteRecords();
    return {
      task,
      conversationId,
      sourceConversationId: request.chatId,
      copiedMessageIds: selectedMessageIds,
      contextRefs,
    };
  }

  private requireQuickChat(chatId: string): QuickChatRow {
    const row = this.dependencies.db
      .prepare(
        `SELECT c.id, c.task_id AS taskId, l.id AS laneId,
                l.runtime_kind AS runtimeKind,
                l.provider_kind AS providerKind, l.model,
                l.workspace_path AS workspacePath
         FROM conversations c
         JOIN tasks t ON t.id = c.task_id AND t.kind = 'quick_chat'
         JOIN runtime_lanes l ON l.task_id = t.id
         WHERE c.id = ? AND c.kind = 'quick_chat'
         ORDER BY l.created_at, l.id LIMIT 1`,
      )
      .get(chatId) as QuickChatRow | undefined;
    if (!row) throw new Error(`Quick chat ${chatId} não encontrado`);
    return row;
  }

  private selectedContext(chatId: string): string[] {
    const row = this.dependencies.db
      .prepare(
        `SELECT content_json FROM messages
         WHERE conversation_id = ? AND role = 'context_selection'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(chatId) as { content_json: string } | undefined;
    if (!row) return [];
    const parsed = JSON.parse(row.content_json) as { contextRefs?: unknown };
    return Array.isArray(parsed.contextRefs)
      ? parsed.contextRefs.filter(
          (ref): ref is string => typeof ref === "string",
        )
      : [];
  }

  private selectedMessages(chatId: string, ids: string[]): StoredMessage[] {
    if (ids.length === 0) return [];
    const selected = new Set(ids);
    const rows = this.dependencies.db
      .prepare(
        `SELECT id, role, content_json FROM messages
         WHERE conversation_id = ? AND role IN ('user', 'assistant')
         ORDER BY sequence`,
      )
      .all(chatId) as StoredMessageRow[];
    return rows
      .filter((row) => selected.has(row.id))
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: JSON.parse(row.content_json) as Record<string, unknown>,
      }));
  }

  private insertMessage(
    conversationId: string,
    role: string,
    content: Record<string, unknown>,
  ): { id: string; createdAt: string } {
    const id = this.dependencies.createId();
    const createdAt = this.clock().toISOString();
    this.dependencies.db
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, sequence, role, content_json, created_at)
         SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?
         FROM messages WHERE conversation_id = ?`,
      )
      .run(
        id,
        conversationId,
        role,
        JSON.stringify(content),
        createdAt,
        conversationId,
      );
    return { id, createdAt };
  }
}

interface QuickChatRow {
  id: string;
  taskId: string;
  laneId: string;
  runtimeKind: RuntimeKind;
  providerKind: "claude_max" | "chatgpt";
  model: string;
  workspacePath: string | null;
}

interface StoredMessageRow {
  id: string;
  role: "user" | "assistant";
  content_json: string;
}

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: Record<string, unknown>;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
