import { dialog } from "electron";
import { spawn as spawnPty, type IPty } from "node-pty";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import {
  existsSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { canonicalEventSchema } from "../../shared/contracts/event";
import {
  eventChannel,
  ipcChannels,
  ipcRequestSchemas,
  ipcResponseSchemas,
  type IpcChannel,
  type IpcRequest,
} from "../../shared/contracts/ipc";
import type { RuntimeKind } from "../../shared/contracts/lane";
import type { RunId } from "../../shared/ids";
import { AuditRepository } from "../db/repositories/audit";
import { exportAuditRepository } from "../audit/export";
import type { TaskRecord } from "../db/repositories/tasks";
import type { OpenedLane } from "../orchestration/lane-service";
import { QuickChatService } from "../orchestration/quick-chat";
import { MemoryService } from "../memory/indexer";
import type { RunHandle, RuntimeHealth } from "../runtime/adapter";
import { createUsageCommands, type UsageCommands } from "../usage/service";
import type { AppState } from "./app-state";
import {
  readAgents,
  readCliSettings,
  readMcpServers,
  readMemoryFile,
  readMemoryFiles,
  readSkills,
  writeMemoryFile,
} from "../ecosystem/readers";

import type { ModelCatalogEntry } from "../runtime/model-catalog";
import {
  createCliCapabilityDetector,
  type CliCapability,
} from "../ecosystem/cli-capabilities";
import {
  actorsMatch,
  budgetExceeded,
  LeaseRepository,
  resourceMatches,
} from "../policy/lease";
import {
  KanbanCardRepository,
  KanbanCardService,
  type KanbanCardMutationResult,
} from "../kanban/service";
import type { InboxApplicationService } from "../inbox/application-service";
import { InboxReplyDraftService } from "../inbox/reply-draft-service";
import { InboxReplyGenerationService } from "../inbox/reply-generation-service";
import { InboxTaskActionService } from "../inbox/task-action-service";
import { InboxOutgoingSettingsService } from "../inbox/outgoing-settings-service";
import { ReplyDispatchService } from "../inbox/reply-dispatch-service";

export type { ModelCatalogEntry };

export type InboxIpcService = Pick<
  InboxApplicationService,
  | "listAccounts"
  | "addImapAccount"
  | "removeAccount"
  | "syncAccount"
  | "listThreads"
  | "getThread"
  | "markThreadRead"
>;

export type InboxTaskActionIpcService = Pick<
  InboxTaskActionService,
  "createKanbanTask"
>;

export type InboxReplyDraftIpcService = Pick<
  InboxReplyDraftService,
  "createReplyDraft" | "listReplyActions"
>;

export type InboxReplyGenerationIpcService = Pick<
  InboxReplyGenerationService,
  "generateReplyDraft"
>;

export type InboxOutgoingSettingsIpcService = Pick<
  InboxOutgoingSettingsService,
  "get" | "save"
>;

export type InboxReplyDispatchIpcService = Pick<
  ReplyDispatchService,
  "approveAndSend"
>;

interface RegisterIpcHandlersOptions {
  ipcMain: Pick<IpcMain, "handle">;
  rendererUrl: string;
  state: AppState;
  modelCatalog?: () => ModelCatalogEntry[];
  laneEffort?: Map<string, string>;
  clientCapabilities?: () => Promise<CliCapability[]>;
  memoryService?: MemoryService;
  inboxService?: InboxIpcService;
  inboxTaskActionService?: InboxTaskActionIpcService;
  inboxReplyDraftService?: InboxReplyDraftIpcService;
  inboxReplyGenerationService?: InboxReplyGenerationIpcService;
  inboxOutgoingSettingsService?: InboxOutgoingSettingsIpcService;
  inboxReplyDispatchService?: InboxReplyDispatchIpcService;
}

interface TaskRow {
  id: string;
  kind: TaskRecord["kind"];
  title: string;
  objective: string;
  status: string;
  workspace_path: string | null;
  created_at: string;
  updated_at: string;
}

const runtimeKinds = ["claude", "codex"] as const;

export function registerIpcHandlers({
  ipcMain,
  rendererUrl,
  state,
  modelCatalog = () => [],
  laneEffort = new Map<string, string>(),
  clientCapabilities = createCliCapabilityDetector(),
  memoryService,
  inboxService,
  inboxTaskActionService,
  inboxReplyDraftService,
  inboxReplyGenerationService,
  inboxOutgoingSettingsService,
  inboxReplyDispatchService,
}: RegisterIpcHandlersOptions): void {
  const openedLanes = new Map<string, OpenedLane>();
  let memory = memoryService;
  const getMemoryService = () =>
    (memory ??= new MemoryService({ db: state.database }));
  let quickChat: QuickChatService | undefined;
  const quickChatService = () =>
    (quickChat ??= new QuickChatService({
      db: state.database,
      tasks: state.tasks,
      lanes: state.lanes,
      audit: new AuditRepository(state.database),
      laneService: state.laneService,
      memory: getMemoryService(),
      createId: state.createId,
      clock: state.clock,
    }));
  let usage: UsageCommands | undefined;
  const usageService = () => {
    if (usage === undefined) usage = createUsageCommands(state);
    return usage;
  };
  let kanban: KanbanCardService | undefined;
  const kanbanService = () =>
    (kanban ??= new KanbanCardService({
      cards: new KanbanCardRepository(state.database),
      lanes: state.lanes,
      createId: state.createId,
      clock: () => state.clock().toISOString(),
    }));
  const getInboxService = () => {
    if (!inboxService) throw new Error("Inbox is unavailable.");
    return inboxService;
  };
  let inboxActions = inboxTaskActionService;
  const getInboxTaskActionService = () =>
    (inboxActions ??= new InboxTaskActionService({
      db: state.database,
      createId: state.createId,
      clock: () => state.clock().toISOString(),
    }));
  let inboxReplyDrafts = inboxReplyDraftService;
  const getInboxReplyDraftService = () =>
    (inboxReplyDrafts ??= new InboxReplyDraftService({ db: state.database }));
  let inboxReplyGeneration = inboxReplyGenerationService;
  const getInboxReplyGenerationService = () =>
    (inboxReplyGeneration ??= new InboxReplyGenerationService({
      state,
      modelCatalog,
    }));
  let inboxOutgoingSettings = inboxOutgoingSettingsService;
  const getInboxOutgoingSettingsService = () =>
    (inboxOutgoingSettings ??= new InboxOutgoingSettingsService({
      db: state.database,
      clock: () => state.clock().toISOString(),
    }));
  const getInboxReplyDispatchService = () => {
    if (!inboxReplyDispatchService) {
      throw new Error("Inbox reply dispatch is unavailable.");
    }
    return inboxReplyDispatchService;
  };

  for (const channel of ipcChannels) {
    ipcMain.handle(channel, async (event, payload) => {
      assertTrustedRenderer(event, rendererUrl);
      const request = ipcRequestSchemas[channel].parse(payload);
      const response = await dispatch(
        channel,
        request,
        event,
        state,
        openedLanes,
        quickChatService,
        usageService,
        modelCatalog,
        laneEffort,
        clientCapabilities,
        getMemoryService,
        kanbanService,
        getInboxService,
        getInboxTaskActionService,
        getInboxReplyDraftService,
        getInboxReplyGenerationService,
        getInboxOutgoingSettingsService,
        getInboxReplyDispatchService,
      );
      return ipcResponseSchemas[channel].parse(response);
    });
  }
}

async function dispatch(
  channel: IpcChannel,
  request: unknown,
  event: IpcMainInvokeEvent,
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  quickChatService: () => QuickChatService,
  usageService: () => UsageCommands,
  modelCatalog: () => ModelCatalogEntry[],
  laneEffort: Map<string, string>,
  clientCapabilities: () => Promise<CliCapability[]>,
  getMemoryService: () => MemoryService,
  kanbanService: () => KanbanCardService,
  inboxService: () => InboxIpcService,
  inboxTaskActionService: () => InboxTaskActionIpcService,
  inboxReplyDraftService: () => InboxReplyDraftIpcService,
  inboxReplyGenerationService: () => InboxReplyGenerationIpcService,
  inboxOutgoingSettingsService: () => InboxOutgoingSettingsIpcService,
  inboxReplyDispatchService: () => InboxReplyDispatchIpcService,
): Promise<unknown> {
  switch (channel) {
    case "system:doctor":
      return systemDoctor(state, clientCapabilities);
    case "models:list":
      return modelCatalog();
    case "task:create":
      return createTask(state, request as IpcRequest<"task:create">);
    case "task:rename":
      return renameTask(state, request as IpcRequest<"task:rename">);
    case "task:delete":
      return deleteTask(state, request as IpcRequest<"task:delete">);
    case "file:pick":
      return pickFiles(request as IpcRequest<"file:pick">);
    case "fs:list":
      return listWorkspaceDir(state, request as IpcRequest<"fs:list">);
    case "fs:read":
      return readWorkspaceFile(state, request as IpcRequest<"fs:read">);
    case "fs:search":
      return searchWorkspaceFiles(state, request as IpcRequest<"fs:search">);
    case "terminal:open":
      return openTerminal(
        state,
        event.sender,
        request as IpcRequest<"terminal:open">,
      );
    case "terminal:write": {
      const write = request as IpcRequest<"terminal:write">;
      terminals.get(write.termId)?.write(write.data);
      return { ok: true as const };
    }
    case "terminal:resize": {
      const resize = request as IpcRequest<"terminal:resize">;
      terminals.get(resize.termId)?.resize(resize.cols, resize.rows);
      return { ok: true as const };
    }
    case "run:list":
      return listRuns(state, request as IpcRequest<"run:list">);
    case "run:events":
      return listRunEvents(state, request as IpcRequest<"run:events">);
    case "lane:setPermissionMode": {
      const set = request as IpcRequest<"lane:setPermissionMode">;
      const result = state.database
        .prepare(
          `UPDATE runtime_lanes SET permission_mode = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(set.mode, state.clock().toISOString(), set.laneId);
      if (result.changes !== 1) {
        throw new Error(`Lane ${set.laneId} not found`);
      }
      // Dropping the opened lane forces the next turn to spawn the CLI again,
      // which is what actually applies the mode.
      openedLanes.delete(set.laneId);
      return set;
    }
    case "task:archive":
      return archiveTask(state, request as IpcRequest<"task:archive">);
    case "task:fork":
      return forkTask(state, request as IpcRequest<"task:fork">);
    case "eco:mcp":
      return readMcpServers(
        (request as IpcRequest<"eco:mcp">).workspacePath ?? null,
      );
    case "eco:skills":
      return readSkills();
    case "eco:memoryList":
      return readMemoryFiles(
        (request as IpcRequest<"eco:memoryList">).workspacePath ?? null,
      );
    case "eco:memoryRead":
      return {
        content: readMemoryFile((request as IpcRequest<"eco:memoryRead">).path),
      };
    case "eco:memoryWrite": {
      const write = request as IpcRequest<"eco:memoryWrite">;
      writeMemoryFile(write.path, write.content);
      return { ok: true as const };
    }
    case "eco:settings":
      return readCliSettings();
    case "eco:agents":
      return readAgents(
        (request as IpcRequest<"eco:agents">).workspacePath ?? null,
      );
    case "conversation:export":
      return exportConversation(
        state,
        request as IpcRequest<"conversation:export">,
      );
    case "audit:export":
      return exportAuditLog(state, request as IpcRequest<"audit:export">);
    case "terminal:close": {
      const close = request as IpcRequest<"terminal:close">;
      terminals.get(close.termId)?.kill();
      terminals.delete(close.termId);
      return { ok: true as const };
    }
    case "workspace:pick":
      return pickWorkspace(request as IpcRequest<"workspace:pick">);
    case "task:list":
      return listWorkbenchTasks(state);
    case "kanban:list":
      return kanbanService().list();
    case "kanban:create":
      return createKanbanCard(
        state,
        openedLanes,
        event.sender,
        laneEffort,
        kanbanService(),
        request as IpcRequest<"kanban:create">,
      );
    case "kanban:move":
      return mutateKanbanCard(
        state,
        openedLanes,
        event.sender,
        laneEffort,
        kanbanService(),
        request as IpcRequest<"kanban:move">,
        (input) => kanbanService().move(input),
      );
    case "kanban:assign":
      return mutateKanbanCard(
        state,
        openedLanes,
        event.sender,
        laneEffort,
        kanbanService(),
        request as IpcRequest<"kanban:assign">,
        (input) => kanbanService().assign(input),
      );
    case "lane:list":
      return listLanes(state, request as IpcRequest<"lane:list">);
    case "conversation:history":
      return conversationHistory(
        state,
        request as IpcRequest<"conversation:history">,
      );
    case "lane:ensure":
      return ensureLane(
        state,
        openedLanes,
        request as IpcRequest<"lane:ensure">,
      );
    case "lane:open":
      return openLane(state, openedLanes, request as IpcRequest<"lane:open">);
    case "lane:sendTurn":
      return sendLaneTurn(
        state,
        openedLanes,
        event.sender,
        request as IpcRequest<"lane:sendTurn">,
        laneEffort,
      );
    case "run:cancel":
      return cancelRun(state, request as IpcRequest<"run:cancel">);
    case "approval:resolve":
      return resolveApproval(
        state,
        openedLanes,
        request as IpcRequest<"approval:resolve">,
      );
    case "quickChat:create":
      return quickChatService().create(
        (request as IpcRequest<"quickChat:create">).runtime,
      );
    case "quickChat:send":
      return sendQuickChat(
        quickChatService(),
        event.sender,
        state,
        request as IpcRequest<"quickChat:send">,
      );
    case "usage:overview":
      return usageService().overview("overview");
    case "usage:refresh":
      return usageService().overview("refresh");
    case "usage:alertSet":
      return usageService().setAlert(request as IpcRequest<"usage:alertSet">);
    case "memory:configure":
      return getMemoryService().configure(
        (request as IpcRequest<"memory:configure">).paths,
      );
    case "memory:list":
      return getMemoryService().listSources();
    case "memory:search":
      return getMemoryService().search(
        (request as IpcRequest<"memory:search">).query,
        (request as IpcRequest<"memory:search">).limit,
      );
    case "memory:reindex":
      return getMemoryService().reindex(
        (request as IpcRequest<"memory:reindex">).sourceId,
      );
    case "inbox:accounts:list":
      return inboxService().listAccounts();
    case "inbox:account:add":
      return inboxService().addImapAccount(
        request as IpcRequest<"inbox:account:add">,
      );
    case "inbox:account:remove":
      return inboxService().removeAccount(
        (request as IpcRequest<"inbox:account:remove">).accountId,
      );
    case "inbox:account:sync":
      return inboxService().syncAccount(
        (request as IpcRequest<"inbox:account:sync">).accountId,
      );
    case "inbox:account:outgoing:get":
      return inboxOutgoingSettingsService().get(
        (request as IpcRequest<"inbox:account:outgoing:get">).accountId,
      );
    case "inbox:account:outgoing:set": {
      const outgoing = request as IpcRequest<"inbox:account:outgoing:set">;
      return inboxOutgoingSettingsService().save({
        accountId: outgoing.accountId,
        ...outgoing.configuration,
      });
    }
    case "inbox:threads:list":
      return inboxService().listThreads(
        request as IpcRequest<"inbox:threads:list">,
      );
    case "inbox:thread:get":
      return inboxService().getThread(
        (request as IpcRequest<"inbox:thread:get">).threadId,
      );
    case "inbox:thread:markRead":
      return inboxService().markThreadRead(
        (request as IpcRequest<"inbox:thread:markRead">).threadId,
      );
    case "inbox:thread:createTask":
      return inboxTaskActionService().createKanbanTask(
        request as IpcRequest<"inbox:thread:createTask">,
      );
    case "inbox:thread:createReplyDraft":
      return inboxReplyDraftService().createReplyDraft(
        request as IpcRequest<"inbox:thread:createReplyDraft">,
      );
    case "inbox:thread:generateReplyDraft":
      return inboxReplyGenerationService().generateReplyDraft(
        request as IpcRequest<"inbox:thread:generateReplyDraft">,
        {
          onEvent: (candidate) =>
            persistAndForwardEvent(state, event.sender, candidate),
        },
      );
    case "inbox:thread:replyActions:list":
      return inboxReplyDraftService().listReplyActions(
        (request as IpcRequest<"inbox:thread:replyActions:list">).threadId,
      );
    case "inbox:reply:approveAndSend":
      return inboxReplyDispatchService().approveAndSend(
        (request as IpcRequest<"inbox:reply:approveAndSend">).outboxId,
      );
  }
}

async function sendQuickChat(
  quickChat: QuickChatService,
  sender: Pick<WebContents, "send">,
  state: AppState,
  request: IpcRequest<"quickChat:send">,
) {
  if ("promotion" in request) {
    return quickChat.promote({
      chatId: request.chatId,
      ...request.promotion,
    });
  }
  const result = await quickChat.send(
    request.chatId,
    request.input,
    request.contextRefs,
  );
  void forwardEvents(state, sender, result.run).catch(
    state.reportBackgroundError,
  );
  return {
    runId: result.run.runId,
    laneId: result.laneId,
    messageId: result.messageId,
    status: "running" as const,
  };
}

function listLanes(state: AppState, request: IpcRequest<"lane:list">) {
  return state.laneService.list(request.taskId);
}

async function systemDoctor(
  state: AppState,
  clientCapabilities: () => Promise<CliCapability[]>,
) {
  state.database.prepare("SELECT 1 AS healthy").get();
  const runtimes = await Promise.all(
    runtimeKinds.map(async (runtime) => {
      const adapter = state.runtimes.lookup(runtime);
      if (!adapter) {
        return {
          runtime,
          status: "unavailable" as const,
          version: null,
          detail: "runtime_unavailable" as const,
        };
      }
      return runtimeProjection(runtime, await adapter.detect());
    }),
  );
  return {
    database: "ok" as const,
    runtimes,
    clients: await clientCapabilities(),
  };
}

function runtimeProjection(runtime: RuntimeKind, health: RuntimeHealth) {
  if (!health.available) {
    return {
      runtime,
      status: "unavailable" as const,
      version: health.version,
      detail: "runtime_unavailable" as const,
    };
  }
  if (!health.protocolSupported) {
    return {
      runtime,
      status: "degraded" as const,
      version: health.version,
      detail: "protocol_unsupported" as const,
    };
  }
  return {
    runtime,
    status: "ready" as const,
    version: health.version,
    detail: null,
  };
}

// Carves a dedicated git worktree for the conversation next to the repo:
// <repo>-okami/<slug>. Falls back to the plain folder when not a repo.
function prepareWorktree(repoPath: string, slug: string): string {
  const container = `${repoPath.replace(/\/+$/u, "")}-okami`;
  mkdirSync(container, { recursive: true });
  const target = nodePath.join(container, slug);
  const head = execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync(
    "git",
    ["-C", repoPath, "worktree", "add", "--detach", target, head],
    { encoding: "utf8" },
  );
  return target;
}

function createTask(
  state: AppState,
  request: IpcRequest<"task:create">,
): TaskRecord {
  const now = state.clock().toISOString();
  let workspacePath = request.workspacePath ?? null;
  if (
    request.useWorktree &&
    workspacePath &&
    existsSync(nodePath.join(workspacePath, ".git"))
  ) {
    const slug = `conversa-${now.replaceAll(/[:.]/gu, "-")}`;
    workspacePath = prepareWorktree(workspacePath, slug);
  }
  const task = {
    id: state.createId(),
    kind: "workbench" as const,
    title: request.title,
    objective: request.objective,
    status: "active",
    workspacePath,
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.insert(task);
  return task;
}

function renameTask(
  state: AppState,
  request: IpcRequest<"task:rename">,
): TaskRecord {
  state.database
    .prepare(`UPDATE tasks SET title = ?, updated_at = ? WHERE id = ?`)
    .run(request.title, state.clock().toISOString(), request.taskId);
  const task = listTasks(state).find((row) => row.id === request.taskId);
  if (!task) throw new Error(`Task ${request.taskId} not found`);
  return task;
}

// Removes the task and every dependent row, children first so the foreign
// keys hold throughout the transaction.
function deleteTask(state: AppState, request: IpcRequest<"task:delete">) {
  const existing = state.database
    .prepare(`SELECT id FROM tasks WHERE id = ?`)
    .get(request.taskId);
  if (!existing) return { taskId: request.taskId, deleted: false };
  const run = state.database.transaction((taskId: string) => {
    const byRun = `run_id IN (SELECT id FROM runs WHERE task_id = ?)`;
    const byLane = `lane_id IN (SELECT id FROM runtime_lanes WHERE task_id = ?)`;
    state.database.prepare(`DELETE FROM artifacts WHERE ${byRun}`).run(taskId);
    state.database.prepare(`DELETE FROM approvals WHERE ${byRun}`).run(taskId);
    state.database.prepare(`DELETE FROM events WHERE task_id = ?`).run(taskId);
    state.database
      .prepare(
        `DELETE FROM event_cursors WHERE ${byLane}
         OR source_lane_id IN (SELECT id FROM runtime_lanes WHERE task_id = ?)`,
      )
      .run(taskId, taskId);
    state.database
      .prepare(`DELETE FROM capability_leases WHERE task_id = ?`)
      .run(taskId);
    state.database
      .prepare(`DELETE FROM usage_activity_buckets WHERE ${byLane}`)
      .run(taskId);
    state.database
      .prepare(`DELETE FROM native_session_bindings WHERE ${byLane}`)
      .run(taskId);
    state.database.prepare(`DELETE FROM runs WHERE task_id = ?`).run(taskId);
    state.database
      .prepare(`DELETE FROM runtime_lanes WHERE task_id = ?`)
      .run(taskId);
    state.database
      .prepare(
        `DELETE FROM messages WHERE conversation_id IN
         (SELECT id FROM conversations WHERE task_id = ?)`,
      )
      .run(taskId);
    state.database
      .prepare(`DELETE FROM conversations WHERE task_id = ?`)
      .run(taskId);
    state.database.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  });
  run(request.taskId);
  return { taskId: request.taskId, deleted: true };
}

async function pickFiles(request: IpcRequest<"file:pick">) {
  const result = await dialog.showOpenDialog({
    title: "Anexar arquivos à mensagem",
    buttonLabel: "Anexar",
    ...(request.defaultPath ? { defaultPath: request.defaultPath } : {}),
    properties: ["openFile", "multiSelections"],
  });
  return { paths: result.canceled ? [] : result.filePaths };
}

// Live shells for the embedded terminal, keyed by termId.
const terminals = new Map<string, IPty>();

function openTerminal(
  state: AppState,
  sender: Pick<WebContents, "send" | "isDestroyed">,
  request: IpcRequest<"terminal:open">,
) {
  const row = state.database
    .prepare(`SELECT workspace_path FROM tasks WHERE id = ?`)
    .get(request.taskId) as { workspace_path: string | null } | undefined;
  const cwd = row?.workspace_path ?? homedir();
  const shell = process.env.SHELL ?? "/bin/zsh";
  const termId = state.createId();
  const pty = spawnPty(shell, ["-l"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: process.env as Record<string, string>,
  });
  pty.onData((data) => {
    if (!sender.isDestroyed()) {
      sender.send("terminal:data", { termId, data });
    }
  });
  pty.onExit(() => {
    terminals.delete(termId);
    if (!sender.isDestroyed()) {
      sender.send("terminal:data", { termId, exited: true });
    }
  });
  terminals.set(termId, pty);
  return { termId };
}

// What a single background run actually did, for the panel's detail view.
function listRunEvents(state: AppState, request: IpcRequest<"run:events">) {
  const rows = state.database
    .prepare(
      `SELECT payload_json, id, task_id, lane_id, run_id, sequence,
              occurred_at, kind, native_event_id
       FROM events WHERE run_id = ? ORDER BY sequence`,
    )
    .all(request.runId) as Array<{
    payload_json: string;
    id: string;
    task_id: string;
    lane_id: string;
    run_id: string;
    sequence: number;
    occurred_at: string;
    kind: string;
    native_event_id: string | null;
  }>;
  return rows.map((row) =>
    canonicalEventSchema.parse({
      schemaVersion: 1,
      id: row.id,
      taskId: row.task_id,
      laneId: row.lane_id,
      runId: row.run_id,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      kind: row.kind,
      nativeEventId: row.native_event_id,
      payload: sanitizePayload(
        JSON.parse(row.payload_json) as Record<string, unknown>,
      ),
    }),
  );
}

function archiveTask(state: AppState, request: IpcRequest<"task:archive">) {
  state.database
    .prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
    .run(
      request.archived ? "archived" : "active",
      state.clock().toISOString(),
      request.taskId,
    );
  const task = listTasks(state).find((row) => row.id === request.taskId);
  if (!task) throw new Error(`Task ${request.taskId} not found`);
  return task;
}

// A fork starts a fresh conversation on the same folder: the lanes come
// along so the models stay, the transcript does not.
function forkTask(state: AppState, request: IpcRequest<"task:fork">) {
  const source = listTasks(state).find((row) => row.id === request.taskId);
  if (!source) throw new Error(`Task ${request.taskId} not found`);
  const now = state.clock().toISOString();
  const forked = {
    id: state.createId(),
    kind: "workbench" as const,
    title: `${source.title} (fork)`,
    objective: source.objective,
    status: "active",
    workspacePath: source.workspacePath,
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.insert(forked);
  const lanes = state.database
    .prepare(
      `SELECT runtime_kind, provider_kind, model, workspace_path
       FROM runtime_lanes WHERE task_id = ?`,
    )
    .all(request.taskId) as Array<{
    runtime_kind: "claude" | "codex";
    provider_kind: string;
    model: string;
    workspace_path: string | null;
  }>;
  for (const lane of lanes) {
    state.lanes.insert({
      id: state.createId(),
      taskId: forked.id,
      runtimeKind: lane.runtime_kind,
      providerKind: lane.provider_kind as "claude_max" | "chatgpt",
      model: lane.model,
      status: "ready",
      workspacePath: lane.workspace_path,
      lastEventCursor: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  return forked;
}

// Writes the transcript as Markdown wherever the user points the dialog.
async function exportConversation(
  state: AppState,
  request: IpcRequest<"conversation:export">,
) {
  const task = listTasks(state).find((row) => row.id === request.taskId);
  if (!task) throw new Error(`Task ${request.taskId} not found`);
  const history = conversationHistory(state, { taskId: request.taskId });
  const lines = [`# ${task.title}`, ""];
  if (task.workspacePath) lines.push(`Pasta: ${task.workspacePath}`, "");
  for (const message of history.userMessages) {
    lines.push(`## Você · ${message.at}`, "", message.body, "");
  }
  for (const event of history.events) {
    if (event.kind !== "message_completed") continue;
    const text = event.payload.text;
    if (typeof text === "string" && text.trim()) {
      lines.push(`## Agente · ${event.occurredAt}`, "", text, "");
    }
  }
  const result = await dialog.showSaveDialog({
    title: "Exportar conversa",
    defaultPath: `${task.title.replaceAll("/", "-")}.md`,
  });
  if (result.canceled || !result.filePath) return { path: null };
  writeFileSync(result.filePath, lines.join("\n"), "utf8");
  return { path: result.filePath };
}

// Selecting the destination is the human grant. The main process narrows it
// to a short-lived, single-use lease before any audit data reaches disk.
async function exportAuditLog(
  state: AppState,
  request: IpcRequest<"audit:export">,
) {
  const task = state.tasks.findById(request.taskId);
  if (!task) throw new Error(`Task ${request.taskId} not found`);
  const lane = state.lanes.findById(request.laneId);
  if (!lane || lane.taskId !== task.id) {
    throw new Error(`Lane ${request.laneId} does not belong to the task`);
  }

  const result = await dialog.showSaveDialog({
    title: "Exportar auditoria",
    defaultPath: `okami-auditoria-${state.clock().toISOString().slice(0, 10)}.jsonl`,
    filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
  });
  if (result.canceled || !result.filePath) {
    return { path: null, entryCount: 0 };
  }

  const now = state.clock();
  const actor = { kind: "human" as const, id: "local-user" };
  const leaseId = state.createId();
  const leases = new LeaseRepository(state.database);
  leases.insert({
    id: leaseId,
    taskId: task.id,
    laneId: lane.id,
    actor,
    capability: "audit.export",
    resourcePattern: result.filePath,
    budget: { maxUses: 1, used: 0 },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    revokedAt: null,
  });

  const lease = leases.findById(leaseId);
  if (
    !lease ||
    !actorsMatch(lease.actor, actor) ||
    lease.taskId !== task.id ||
    lease.laneId !== lane.id ||
    lease.capability !== "audit.export" ||
    !resourceMatches(lease.resourcePattern, result.filePath) ||
    budgetExceeded(lease.budget, 1)
  ) {
    throw new Error("Audit export lease was rejected");
  }

  state.database
    .prepare(`UPDATE capability_leases SET budget_json = ? WHERE id = ?`)
    .run(JSON.stringify({ maxUses: 1, used: 1 }), lease.id);

  const audit = new AuditRepository(state.database);
  audit.record({
    id: state.createId(),
    taskId: task.id,
    laneId: lane.id,
    runId: null,
    actor: JSON.stringify(actor),
    action: "audit_export_authorized",
    decision: "allow",
    capability: "audit.export",
    resource: { path: result.filePath },
    metadata: { leaseId: lease.id, maxUses: 1 },
    occurredAt: now.toISOString(),
  });

  const filesystemPaths = (
    state.database
      .prepare(
        `SELECT workspace_path AS path FROM tasks WHERE workspace_path IS NOT NULL
         UNION SELECT root_path AS path FROM memory_sources
         UNION SELECT scope_path AS path FROM memory_sources`,
      )
      .all() as Array<{ path: string }>
  ).map(({ path }) => path);
  filesystemPaths.push(result.filePath);

  const exported = await exportAuditRepository(audit, {
    path: result.filePath,
    writer: {
      append(path, contents) {
        appendFileSync(path, contents, { encoding: "utf8", flag: "a" });
      },
    },
    redaction: { filesystemPaths },
  });
  return { path: result.filePath, entryCount: exported.entryCount };
}

async function createKanbanCard(
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  sender: Pick<WebContents, "send">,
  laneEffort: Map<string, string>,
  kanban: KanbanCardService,
  request: IpcRequest<"kanban:create">,
) {
  if (
    request.ownerKind === "lane" &&
    (!request.laneId || !state.lanes.findById(request.laneId))
  ) {
    throw new Error("A delegated Kanban card requires an available lane");
  }
  const card = kanban.create({
    title: request.title,
    description: request.description,
    status: request.status,
  });
  if (request.ownerKind === "human") {
    return {
      card,
      wake: {
        shouldWake: false,
        reason: "manual_policy",
        delta: {
          stateChanged: false,
          statusChanged: false,
          ownerChanged: false,
          laneChanged: false,
        },
      },
    };
  }
  const idempotencyKey = state.createId();
  const assigned = kanban.assign({
    cardId: card.id,
    ownerKind: "lane",
    laneId: request.laneId as string,
    activationPolicy: request.activationPolicy,
    idempotencyKey,
  });
  return dispatchKanbanWake(
    state,
    openedLanes,
    sender,
    laneEffort,
    kanban,
    assigned,
    idempotencyKey,
  );
}

async function mutateKanbanCard<T extends { idempotencyKey: string }>(
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  sender: Pick<WebContents, "send">,
  laneEffort: Map<string, string>,
  kanban: KanbanCardService,
  request: T,
  operation: (input: T) => KanbanCardMutationResult,
) {
  return dispatchKanbanWake(
    state,
    openedLanes,
    sender,
    laneEffort,
    kanban,
    operation(request),
    request.idempotencyKey,
  );
}

async function dispatchKanbanWake(
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  sender: Pick<WebContents, "send">,
  laneEffort: Map<string, string>,
  kanban: KanbanCardService,
  result: KanbanCardMutationResult,
  idempotencyKey: string,
) {
  if (!result.wake.shouldWake || !result.card.laneId) return result;
  const delta = JSON.stringify(result.wake.delta);
  await sendLaneTurn(
    state,
    openedLanes,
    sender,
    {
      laneId: result.card.laneId,
      input:
        `[Kanban] O card "${result.card.title}" foi atualizado. ` +
        `Status atual: ${result.card.status}. Delta: ${delta}. ` +
        "Verifique a atualização e aja somente se houver trabalho novo dentro do escopo do card.",
    },
    laneEffort,
  );
  return {
    ...result,
    card: kanban.acknowledgeWake(result.card.id, idempotencyKey),
  };
}

interface RunRow {
  id: string;
  lane_id: string;
  model: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_json: string | null;
}

// Feeds the background-tasks panel: what each lane ran, and how it ended.
function listRuns(state: AppState, request: IpcRequest<"run:list">) {
  const rows = state.database
    .prepare(
      `SELECT runs.id, runs.lane_id, runtime_lanes.model, runs.status,
              runs.started_at, runs.finished_at, runs.error_json
       FROM runs
       JOIN runtime_lanes ON runtime_lanes.id = runs.lane_id
       ${request.taskId ? "WHERE runs.task_id = ?" : ""}
       ORDER BY runs.started_at DESC
       LIMIT 60`,
    )
    .all(...(request.taskId ? [request.taskId] : [])) as RunRow[];
  return rows.map((row) => ({
    runId: row.id,
    laneId: row.lane_id,
    model: row.model,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error_json,
  }));
}

const FS_IGNORED = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "dist",
  "out",
  ".next",
  "target",
]);
const FS_READ_LIMIT = 256 * 1024;

// Every fs access resolves inside the task's workspace; anything that
// escapes it (symlinks included) is refused.
function resolveInsideWorkspace(
  state: AppState,
  taskId: string,
  relative: string,
): string {
  const row = state.database
    .prepare(`SELECT workspace_path FROM tasks WHERE id = ?`)
    .get(taskId) as { workspace_path: string | null } | undefined;
  if (!row?.workspace_path) throw new Error("Tarefa sem pasta de trabalho");
  const root = realpathSync(row.workspace_path);
  const target = nodePath.resolve(root, relative);
  const real = realpathSync(target);
  if (real !== root && !real.startsWith(`${root}${nodePath.sep}`)) {
    throw new Error("Caminho fora da pasta da conversa");
  }
  return real;
}

// Feeds the composer's @ menu: a bounded walk of the conversation folder.
function searchWorkspaceFiles(
  state: AppState,
  request: IpcRequest<"fs:search">,
) {
  const root = resolveInsideWorkspace(state, request.taskId, "");
  const term = (request.query ?? "").trim().toLowerCase();
  const matches: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (matches.length >= 40 || depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= 40) return;
      if (FS_IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const relative = nodePath.relative(root, full);
      if (term === "" || relative.toLowerCase().includes(term)) {
        matches.push(relative);
      }
    }
  };
  walk(root, 0);
  return { files: matches };
}

function listWorkspaceDir(state: AppState, request: IpcRequest<"fs:list">) {
  const dir = resolveInsideWorkspace(state, request.taskId, request.dir ?? "");
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !FS_IGNORED.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? ("dir" as const) : ("file" as const),
    }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name)
        : left.kind === "dir"
          ? -1
          : 1,
    );
  return { entries };
}

function readWorkspaceFile(state: AppState, request: IpcRequest<"fs:read">) {
  const file = resolveInsideWorkspace(state, request.taskId, request.file);
  const size = statSync(file).size;
  const buffer = readFileSync(file).subarray(0, FS_READ_LIMIT);
  const binary = buffer.includes(0);
  return {
    content: binary ? "" : buffer.toString("utf8"),
    truncated: size > FS_READ_LIMIT,
    binary,
  };
}

// The Claude/Codex workflow anchors every conversation to a folder the user
// picks; sessions and leases stay scoped to it.
async function pickWorkspace(request: IpcRequest<"workspace:pick">) {
  const memoryPicker = request.purpose === "memory";
  const result = await dialog.showOpenDialog({
    title: memoryPicker
      ? "Escolha a pasta Obsidian para indexar"
      : "Escolha a pasta da conversa",
    buttonLabel: memoryPicker ? "Indexar esta pasta" : "Usar esta pasta",
    properties: ["openDirectory", "createDirectory"],
  });
  return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
}

function conversationHistory(
  state: AppState,
  request: IpcRequest<"conversation:history">,
) {
  const userMessages = (
    state.database
      .prepare(
        `SELECT messages.id, messages.content_json, messages.created_at
         FROM messages
         JOIN conversations ON conversations.id = messages.conversation_id
         WHERE conversations.task_id = ? AND messages.role = 'user'
         ORDER BY messages.sequence`,
      )
      .all(request.taskId) as Array<{
      id: string;
      content_json: string;
      created_at: string;
    }>
  ).map((row) => {
    const content = JSON.parse(row.content_json) as {
      body?: string;
      laneId?: string;
    };
    return {
      id: row.id,
      laneId: content.laneId ?? null,
      body: content.body ?? "",
      at: row.created_at,
    };
  });
  const events = (
    state.database
      .prepare(
        `SELECT payload_json, id, task_id, lane_id, run_id, sequence,
                occurred_at, kind, native_event_id
         FROM events WHERE task_id = ? ORDER BY occurred_at, sequence`,
      )
      .all(request.taskId) as Array<{
      payload_json: string;
      id: string;
      task_id: string;
      lane_id: string;
      run_id: string;
      sequence: number;
      occurred_at: string;
      kind: string;
      native_event_id: string | null;
    }>
  ).map((row) =>
    canonicalEventSchema.parse({
      schemaVersion: 1,
      id: row.id,
      taskId: row.task_id,
      laneId: row.lane_id,
      runId: row.run_id,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      kind: row.kind,
      nativeEventId: row.native_event_id,
      payload: sanitizePayload(
        JSON.parse(row.payload_json) as Record<string, unknown>,
      ),
    }),
  );
  return { userMessages, events };
}

function conversationForTask(state: AppState, taskId: string): string {
  const existing = state.database
    .prepare(
      `SELECT id FROM conversations WHERE task_id = ? AND kind = 'workbench' LIMIT 1`,
    )
    .get(taskId) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = state.createId();
  const now = state.clock().toISOString();
  state.database
    .prepare(
      `INSERT INTO conversations (id, task_id, kind, created_at, updated_at)
       VALUES (?, ?, 'workbench', ?, ?)`,
    )
    .run(id, taskId, now, now);
  return id;
}

function persistUserMessage(
  state: AppState,
  taskId: string,
  laneId: string,
  body: string,
): void {
  const conversationId = conversationForTask(state, taskId);
  const next = state.database
    .prepare(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM messages WHERE conversation_id = ?`,
    )
    .get(conversationId) as { seq: number };
  state.database
    .prepare(
      `INSERT INTO messages (id, conversation_id, sequence, role, content_json, created_at)
       VALUES (?, ?, ?, 'user', ?, ?)`,
    )
    .run(
      state.createId(),
      conversationId,
      next.seq,
      JSON.stringify({ body, laneId }),
      state.clock().toISOString(),
    );
}

function listTasks(state: AppState): TaskRecord[] {
  const rows = state.database
    .prepare(
      `SELECT id, kind, title, objective, status, workspace_path, created_at, updated_at
       FROM tasks
       ORDER BY updated_at DESC, id ASC`,
    )
    .all() as TaskRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    objective: row.objective,
    status: row.status,
    workspacePath: row.workspace_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function listWorkbenchTasks(state: AppState): TaskRecord[] {
  return listTasks(state).filter((task) => task.kind === "workbench");
}

async function openLane(
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  request: IpcRequest<"lane:open">,
) {
  const opened = await state.laneService.open(request.laneId, {
    inheritTask: request.inheritTask,
  });
  openedLanes.set(opened.laneId, opened);
  return openedLaneProjection(opened);
}

// Finds (or creates) the lane for task+runtime+model, then opens it. This is
// what makes the model picker offer full catalogs instead of seeded lanes.
async function ensureLane(
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  request: IpcRequest<"lane:ensure">,
) {
  const existing = state.database
    .prepare(
      `SELECT id FROM runtime_lanes
       WHERE task_id = ? AND runtime_kind = ? AND model = ?
       LIMIT 1`,
    )
    .get(request.taskId, request.runtimeKind, request.model) as
    { id: string } | undefined;
  let laneId = existing?.id;
  if (!laneId) {
    const sibling = state.database
      .prepare(
        `SELECT workspace_path FROM runtime_lanes WHERE task_id = ? LIMIT 1`,
      )
      .get(request.taskId) as { workspace_path: string | null } | undefined;
    // The task folder is authoritative: it is what the user picked when the
    // conversation was created, and it scopes both cwd and leases.
    const owner = state.database
      .prepare(`SELECT workspace_path FROM tasks WHERE id = ?`)
      .get(request.taskId) as { workspace_path: string | null } | undefined;
    laneId = state.createId();
    const now = state.clock().toISOString();
    state.lanes.insert({
      id: laneId,
      taskId: request.taskId,
      runtimeKind: request.runtimeKind,
      providerKind: request.runtimeKind === "claude" ? "claude_max" : "chatgpt",
      model: request.model,
      status: "ready",
      workspacePath: owner?.workspace_path ?? sibling?.workspace_path ?? null,
      lastEventCursor: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  return openLane(state, openedLanes, { laneId });
}

function openedLaneProjection(opened: OpenedLane) {
  return {
    laneId: opened.laneId,
    taskId: opened.taskId,
    runtimeVersion: opened.runtimeVersion,
    temperature: opened.temperature,
    harness: opened.harness,
    runtimeKind: opened.runtimeKind,
    providerAccountLabel: opened.providerAccountLabel,
    model: opened.model,
    routeKind: opened.routeKind,
    routeReason: opened.routeReason,
    displayQuotaAccount: opened.displayQuotaAccount,
    permissionMode: opened.permissionMode,
    workspacePath: opened.workspacePath,
    nativeSessionIdPrefix: opened.nativeSessionIdPrefix,
    status: opened.status,
    pendingDeltaEvents: opened.pendingDeltaEvents,
  };
}

async function sendLaneTurn(
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  sender: Pick<WebContents, "send">,
  request: IpcRequest<"lane:sendTurn">,
  laneEffort: Map<string, string>,
) {
  const opened =
    openedLanes.get(request.laneId) ??
    (await state.laneService.open(request.laneId));
  openedLanes.set(opened.laneId, opened);
  if (request.effort) laneEffort.set(request.laneId, request.effort);
  const laneForTask = state.lanes.findById(request.laneId);
  if (laneForTask) {
    persistUserMessage(
      state,
      laneForTask.taskId,
      request.laneId,
      request.input,
    );
  }
  const run = await state.laneService.sendTurn(
    opened,
    request.input,
    request.effort,
  );
  void forwardEvents(state, sender, run).catch(state.reportBackgroundError);
  return {
    runId: run.runId,
    laneId: opened.laneId,
    status: "running" as const,
  };
}

const TERMINAL_RUN_KINDS: Record<string, string> = {
  run_completed: "completed",
  run_failed: "failed",
  run_cancelled: "cancelled",
};

async function forwardEvents(
  state: AppState,
  sender: Pick<WebContents, "send">,
  run: RunHandle,
): Promise<void> {
  for await (const candidate of run.events) {
    await persistAndForwardEvent(state, sender, candidate);
  }
}

async function persistAndForwardEvent(
  state: AppState,
  sender: Pick<WebContents, "send">,
  candidate: unknown,
): Promise<void> {
  const event = canonicalEventSchema.parse(candidate);
  state.events.append(event);
  // Without this the run row stays "running" forever: the terminal event
  // was streamed to the UI but never written back to the run itself.
  const terminal = TERMINAL_RUN_KINDS[event.kind];
  if (terminal) {
    state.database
      .prepare(
        `UPDATE runs SET status = ?, finished_at = ?
         WHERE id = ? AND finished_at IS NULL`,
      )
      .run(terminal, event.occurredAt, event.runId);
  }
  sender.send(eventChannel, {
    ...event,
    payload: sanitizePayload(event.payload),
  });
}

async function cancelRun(state: AppState, request: IpcRequest<"run:cancel">) {
  const run = state.runs.findById(request.runId);
  if (!run) return { runId: request.runId, cancelled: false };
  const lane = state.lanes.findById(run.laneId);
  if (!lane) throw new Error(`Unknown lane ${run.laneId}`);
  const runtime = state.runtimes.lookup(lane.runtimeKind);
  if (!runtime) throw new Error(`No runtime adapter for ${lane.runtimeKind}`);
  await runtime.cancel(request.runId as RunId);
  return { runId: request.runId, cancelled: true };
}

async function resolveApproval(
  state: AppState,
  openedLanes: Map<string, OpenedLane>,
  request: IpcRequest<"approval:resolve">,
) {
  const approval = state.approvals.findById(request.approvalId);
  if (!approval) throw new Error(`Approval ${request.approvalId} not found`);
  const lane = state.lanes.findById(approval.laneId);
  if (!lane) throw new Error(`Unknown lane ${approval.laneId}`);
  const runtimeKind =
    openedLanes.get(approval.laneId)?.runtimeKind ?? lane.runtimeKind;
  const runtime = state.runtimes.lookup(runtimeKind);
  if (!runtime) throw new Error(`No runtime adapter for ${runtimeKind}`);
  const resolved = state.approvals.resolve(
    approval.id,
    request.decision,
    state.clock().toISOString(),
  );
  await runtime.respondToApproval({
    runId: approval.runId as RunId,
    approvalId: approval.id,
    decision: request.decision,
  });
  return {
    id: resolved.id,
    runId: resolved.runId,
    laneId: resolved.laneId,
    status: resolved.status,
    resolvedAt: resolved.resolvedAt,
  };
}

function assertTrustedRenderer(
  event: IpcMainInvokeEvent,
  rendererUrl: string,
): void {
  if (
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    rendererOrigin(event.senderFrame.url) !== rendererOrigin(rendererUrl)
  ) {
    throw new Error("Untrusted renderer origin");
  }
}

function rendererOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "file:") {
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  }
  return parsed.origin;
}

function sanitizePayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      sensitiveKey(key) ? "[redacted]" : sanitizeValue(value, new WeakSet()),
    ]),
  );
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return sensitiveString(value) ? "[redacted]" : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[redacted]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      sensitiveKey(key) ? "[redacted]" : sanitizeValue(item, seen),
    ]),
  );
}

// Renderer-facing redaction guards credentials only. Paths, SQL and command
// output are the user's own working material — hiding them made every tool
// card read "[redacted]" and the workbench unusable.
function sensitiveKey(key: string): boolean {
  return /(?:(?:provider|access|auth|bearer)[_-]?token|api[_-]?key|authorization|secret)$/iu.test(
    key,
  );
}

function sensitiveString(value: string): boolean {
  return /(?:sk-ant-|sk-[a-zA-Z0-9_-]{16,}|Bearer\s+[a-zA-Z0-9._~-]{8,})/u.test(
    value,
  );
}
