import { tmpdir } from "node:os";
import type { RuntimeKind } from "../../shared/contracts/lane";
import type { Database } from "../db/connection";
import type { AuditRepository } from "../db/repositories/audit";
import type { LaneRepository } from "../db/repositories/lanes";
import type { RunHandle } from "../runtime/adapter";
import type { TaskRecord, TaskRepository } from "../db/repositories/tasks";
import type { LaneService } from "./lane-service";

type QuickChatRuntime = RuntimeKind;

interface QuickChatCreateRequest {
  runtime: QuickChatRuntime;
  model: string;
}

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
  runtime: QuickChatRuntime;
  model: string;
  workspaceId: null;
  createdAt: string;
}

export interface QuickChatSummary extends QuickChatConversation {
  title: string;
  preview: string | null;
  updatedAt: string;
}

export interface QuickChatHistory extends QuickChatSummary {
  messages: Array<Omit<QuickChatMessageRecord, "chatId">>;
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

  create(request: QuickChatCreateRequest): QuickChatConversation {
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
        runtimeKind: request.runtime,
        providerKind: providerForRuntime(request.runtime),
        model: request.model,
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
      runtime: request.runtime,
      model: request.model,
      workspaceId: null,
      createdAt: now,
    };
  }

  list(): QuickChatSummary[] {
    const rows = this.dependencies.db
      .prepare(
        `SELECT c.id, c.task_id AS taskId, t.title, c.created_at AS createdAt,
                c.updated_at AS updatedAt
         FROM conversations c
         JOIN tasks t ON t.id = c.task_id AND t.kind = 'quick_chat'
         WHERE c.kind = 'quick_chat' AND t.status != 'deleted'
           AND EXISTS (
             SELECT 1 FROM messages m
             WHERE m.conversation_id = c.id AND m.role = 'user'
           )
         ORDER BY c.updated_at DESC, c.id DESC`,
      )
      .all() as QuickChatListRow[];
    return rows.map((row) => this.summary(row));
  }

  history(chatId: string): QuickChatHistory {
    const row = this.chatListRow(chatId);
    const summary = this.summary(row);
    const stored = this.dependencies.db
      .prepare(
        `SELECT id, role, content_json, created_at AS createdAt
         FROM messages
         WHERE conversation_id = ? AND role IN ('user', 'assistant')
         ORDER BY sequence`,
      )
      .all(chatId) as HistoryMessageRow[];
    const completed = this.dependencies.db
      .prepare(
        `SELECT e.id, e.payload_json AS payloadJson,
                e.occurred_at AS createdAt
         FROM events e
         WHERE e.task_id = ? AND e.kind = 'message_completed'
         ORDER BY e.occurred_at, e.run_id, e.sequence`,
      )
      .all(row.taskId) as CompletedMessageRow[];
    const messages = [
      ...stored.map((message) => ({
        id: message.id,
        role: message.role,
        body: bodyFromContent(message.content_json),
        createdAt: message.createdAt,
      })),
      ...completed.flatMap((event) => {
        const payload = JSON.parse(event.payloadJson) as { text?: unknown };
        return typeof payload.text === "string" && payload.text.trim()
          ? [
              {
                id: event.id,
                role: "assistant" as const,
                body: payload.text,
                createdAt: event.createdAt,
              },
            ]
          : [];
      }),
    ].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );
    return { ...summary, messages };
  }

  updateModel(request: {
    chatId: string;
    runtime: QuickChatRuntime;
    model: string;
  }): QuickChatConversation {
    const current = this.requireQuickChat(request.chatId);
    const now = this.clock().toISOString();
    const laneId = this.dependencies.createId();
    this.dependencies.lanes.insert({
      id: laneId,
      taskId: current.taskId,
      runtimeKind: request.runtime,
      providerKind: providerForRuntime(request.runtime),
      model: request.model,
      status: "ready",
      workspacePath: null,
      lastEventCursor: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.touchConversation(request.chatId, current.taskId, now);
    return {
      id: request.chatId,
      taskId: current.taskId,
      laneId,
      runtime: request.runtime,
      model: request.model,
      workspaceId: null,
      createdAt: this.chatListRow(request.chatId).createdAt,
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
    effort?: string,
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
    this.updateTitleAndActivity(chatId, chat.taskId, input);
    const opened = await laneService.open(chat.laneId, {
      inheritTask: false,
      workspaceFallbackPath: tmpdir(),
    });
    const runtimeInput = memoryContext
      ? `${memoryContext}\n\n--- OKAMI QUICK CHAT ---\n${JSON.stringify(turn)}`
      : JSON.stringify(turn);
    const run = await laneService.sendTurn(opened, runtimeInput, effort);
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
         ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1`,
      )
      .get(chatId) as QuickChatRow | undefined;
    if (!row) throw new Error(`Quick chat ${chatId} não encontrado`);
    return row;
  }

  private chatListRow(chatId: string): QuickChatListRow {
    const row = this.dependencies.db
      .prepare(
        `SELECT c.id, c.task_id AS taskId, t.title,
                c.created_at AS createdAt, c.updated_at AS updatedAt
         FROM conversations c
         JOIN tasks t ON t.id = c.task_id AND t.kind = 'quick_chat'
         WHERE c.id = ? AND c.kind = 'quick_chat'`,
      )
      .get(chatId) as QuickChatListRow | undefined;
    if (!row) throw new Error(`Quick chat ${chatId} não encontrado`);
    return row;
  }

  private summary(row: QuickChatListRow): QuickChatSummary {
    const chat = this.requireQuickChat(row.id);
    const history = this.dependencies.db
      .prepare(
        `SELECT content_json FROM messages
         WHERE conversation_id = ? AND role IN ('user', 'assistant')
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(row.id) as { content_json: string } | undefined;
    return {
      id: row.id,
      taskId: row.taskId,
      laneId: chat.laneId,
      runtime: chat.runtimeKind,
      model: chat.model,
      workspaceId: null,
      title: row.title,
      preview: history ? bodyFromContent(history.content_json) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private updateTitleAndActivity(
    chatId: string,
    taskId: string,
    input: string,
  ): void {
    const now = this.clock().toISOString();
    const task = this.dependencies.tasks.findById(taskId);
    if (task?.title === "Chat rápido") {
      const title = input.replace(/\s+/gu, " ").trim().slice(0, 72);
      this.dependencies.db
        .prepare("UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?")
        .run(title || "Chat rápido", now, taskId);
    }
    this.touchConversation(chatId, taskId, now);
  }

  private touchConversation(chatId: string, taskId: string, now: string): void {
    this.dependencies.db
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(now, chatId);
    this.dependencies.db
      .prepare("UPDATE tasks SET updated_at = ? WHERE id = ?")
      .run(now, taskId);
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
  runtimeKind: QuickChatRuntime;
  providerKind:
    | "claude_max"
    | "chatgpt"
    | "cursor"
    | "antigravity"
    | "grok"
    | "mimo"
    | "minimax";
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

interface QuickChatListRow {
  id: string;
  taskId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface HistoryMessageRow {
  id: string;
  role: "user" | "assistant";
  content_json: string;
  createdAt: string;
}

interface CompletedMessageRow {
  id: string;
  payloadJson: string;
  createdAt: string;
}

function bodyFromContent(contentJson: string): string {
  const parsed = JSON.parse(contentJson) as { body?: unknown };
  return typeof parsed.body === "string" ? parsed.body : "";
}

function providerForRuntime(runtime: QuickChatRuntime) {
  const providers = {
    claude: "claude_max",
    codex: "chatgpt",
    cursor: "cursor",
    agy: "antigravity",
    grok: "grok",
    mimo: "mimo",
    minimax: "minimax",
  } as const;
  return providers[runtime];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
