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
import type { TaskRecord } from "../db/repositories/tasks";
import type { OpenedLane } from "../orchestration/lane-service";
import { QuickChatService } from "../orchestration/quick-chat";
import type { RunHandle, RuntimeHealth } from "../runtime/adapter";
import { createUsageCommands, type UsageCommands } from "../usage/service";
import type { AppState } from "./app-state";

import type { ModelCatalogEntry } from "../runtime/model-catalog";

export type { ModelCatalogEntry };

interface RegisterIpcHandlersOptions {
  ipcMain: Pick<IpcMain, "handle">;
  rendererUrl: string;
  state: AppState;
  modelCatalog?: () => ModelCatalogEntry[];
  laneEffort?: Map<string, string>;
}

interface TaskRow {
  id: string;
  kind: TaskRecord["kind"];
  title: string;
  objective: string;
  status: string;
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
}: RegisterIpcHandlersOptions): void {
  const openedLanes = new Map<string, OpenedLane>();
  let quickChat: QuickChatService | undefined;
  const quickChatService = () =>
    (quickChat ??= new QuickChatService({
      db: state.database,
      tasks: state.tasks,
      lanes: state.lanes,
      audit: new AuditRepository(state.database),
      laneService: state.laneService,
      createId: state.createId,
      clock: state.clock,
    }));
  let usage: UsageCommands | undefined;
  const usageService = () => {
    if (usage === undefined) usage = createUsageCommands(state);
    return usage;
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
): Promise<unknown> {
  switch (channel) {
    case "system:doctor":
      return systemDoctor(state);
    case "models:list":
      return modelCatalog();
    case "task:create":
      return createTask(state, request as IpcRequest<"task:create">);
    case "task:list":
      return listTasks(state);
    case "lane:list":
      return listLanes(state, request as IpcRequest<"lane:list">);
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
    case "memory:search":
    case "memory:reindex":
      return { status: "not_implemented", channel };
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

async function systemDoctor(state: AppState) {
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
  return { database: "ok" as const, runtimes };
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

function createTask(
  state: AppState,
  request: IpcRequest<"task:create">,
): TaskRecord {
  const now = state.clock().toISOString();
  const task = {
    id: state.createId(),
    kind: "workbench" as const,
    title: request.title,
    objective: request.objective,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.insert(task);
  return task;
}

function listTasks(state: AppState): TaskRecord[] {
  const rows = state.database
    .prepare(
      `SELECT id, kind, title, objective, status, created_at, updated_at
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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
    laneId = state.createId();
    const now = state.clock().toISOString();
    state.lanes.insert({
      id: laneId,
      taskId: request.taskId,
      runtimeKind: request.runtimeKind,
      providerKind: request.runtimeKind === "claude" ? "claude_max" : "chatgpt",
      model: request.model,
      status: "ready",
      workspacePath: sibling?.workspace_path ?? null,
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

async function forwardEvents(
  state: AppState,
  sender: Pick<WebContents, "send">,
  run: RunHandle,
): Promise<void> {
  for await (const candidate of run.events) {
    const event = canonicalEventSchema.parse(candidate);
    state.events.append(event);
    sender.send(eventChannel, {
      ...event,
      payload: sanitizePayload(event.payload),
    });
  }
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

function sensitiveKey(key: string): boolean {
  return /(?:path|cwd|sql|(?:provider|access|auth|bearer)[_-]?token|api[_-]?key|authorization|secret|executable)$/iu.test(
    key,
  );
}

function sensitiveString(value: string): boolean {
  return (
    /(?:sk-ant-|sk-[a-zA-Z0-9_-]{16,}|Bearer\s+[a-zA-Z0-9._~-]{8,})/u.test(
      value,
    ) ||
    /(?:^|[\s"'=(])(?:\/(?:Users|home|private|tmp|var|etc|opt|usr)\/|[a-zA-Z]:\\)/u.test(
      value,
    ) ||
    /(?:^|[;\n])\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\s+/iu.test(
      value,
    )
  );
}
