import type { z } from "zod";
import {
  ipcRequestSchemas,
  ipcResponseSchemas,
  systemDoctorSchema,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
} from "../../../shared/contracts/ipc";

export { systemDoctorSchema };
export type { IpcChannel, IpcRequest, IpcResponse };

export type RendererInvokeFacade = {
  readonly [C in IpcChannel]: (payload: IpcRequest<C>) => Promise<unknown>;
};

export interface RendererOkamiBridge {
  readonly bridgeVersion: 1;
  readonly invoke: RendererInvokeFacade;
  onEvent(listener: (event: unknown) => void): () => void;
  onTerminalData(listener: (chunk: unknown) => void): () => void;
}

declare global {
  interface Window {
    okami: RendererOkamiBridge;
  }
}

export async function invokeParsed<C extends IpcChannel, T>(
  channel: C,
  args: IpcRequest<C>,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await window.okami.invoke[channel](args);
  return schema.parse(raw);
}

async function invokeCommand<C extends IpcChannel>(
  channel: C,
  args: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const requestSchema = ipcRequestSchemas[channel] as unknown as z.ZodType<
    IpcRequest<C>
  >;
  const schema = ipcResponseSchemas[channel] as unknown as z.ZodType<
    IpcResponse<C>
  >;
  return invokeParsed(channel, requestSchema.parse(args), schema);
}

export const workbenchClient = {
  systemDoctor: () => invokeCommand("system:doctor", {}),
  systemOpenExternal: (request: IpcRequest<"system:openExternal">) =>
    invokeCommand("system:openExternal", request),
  taskCreate: (request: IpcRequest<"task:create">) =>
    invokeCommand("task:create", request),
  taskList: () => invokeCommand("task:list", {}),
  kanbanList: () => invokeCommand("kanban:list", {}),
  kanbanCreate: (request: IpcRequest<"kanban:create">) =>
    invokeCommand("kanban:create", request),
  kanbanMove: (request: IpcRequest<"kanban:move">) =>
    invokeCommand("kanban:move", request),
  kanbanAssign: (request: IpcRequest<"kanban:assign">) =>
    invokeCommand("kanban:assign", request),
  taskRename: (request: IpcRequest<"task:rename">) =>
    invokeCommand("task:rename", request),
  taskDelete: (request: IpcRequest<"task:delete">) =>
    invokeCommand("task:delete", request),
  filePick: (request: IpcRequest<"file:pick">) =>
    invokeCommand("file:pick", request),
  fsList: (request: IpcRequest<"fs:list">) => invokeCommand("fs:list", request),
  fsRead: (request: IpcRequest<"fs:read">) => invokeCommand("fs:read", request),
  fsSearch: (request: IpcRequest<"fs:search">) =>
    invokeCommand("fs:search", request),
  terminalOpen: (request: IpcRequest<"terminal:open">) =>
    invokeCommand("terminal:open", request),
  terminalWrite: (request: IpcRequest<"terminal:write">) =>
    invokeCommand("terminal:write", request),
  terminalResize: (request: IpcRequest<"terminal:resize">) =>
    invokeCommand("terminal:resize", request),
  terminalClose: (request: IpcRequest<"terminal:close">) =>
    invokeCommand("terminal:close", request),
  runList: (request: IpcRequest<"run:list">) =>
    invokeCommand("run:list", request),
  runEvents: (request: IpcRequest<"run:events">) =>
    invokeCommand("run:events", request),
  laneSetPermissionMode: (request: IpcRequest<"lane:setPermissionMode">) =>
    invokeCommand("lane:setPermissionMode", request),
  taskArchive: (request: IpcRequest<"task:archive">) =>
    invokeCommand("task:archive", request),
  taskFork: (request: IpcRequest<"task:fork">) =>
    invokeCommand("task:fork", request),
  conversationExport: (request: IpcRequest<"conversation:export">) =>
    invokeCommand("conversation:export", request),
  auditExport: (request: IpcRequest<"audit:export">) =>
    invokeCommand("audit:export", request),
  ecoMcp: (request: IpcRequest<"eco:mcp">) => invokeCommand("eco:mcp", request),
  ecoSkills: () => invokeCommand("eco:skills", {}),
  ecoMemoryList: (request: IpcRequest<"eco:memoryList">) =>
    invokeCommand("eco:memoryList", request),
  ecoMemoryRead: (request: IpcRequest<"eco:memoryRead">) =>
    invokeCommand("eco:memoryRead", request),
  ecoMemoryWrite: (request: IpcRequest<"eco:memoryWrite">) =>
    invokeCommand("eco:memoryWrite", request),
  ecoSettings: () => invokeCommand("eco:settings", {}),
  ecoAgents: (request: IpcRequest<"eco:agents">) =>
    invokeCommand("eco:agents", request),
  workspacePick: (request: IpcRequest<"workspace:pick"> = {}) =>
    invokeCommand("workspace:pick", request),
  conversationHistory: (request: IpcRequest<"conversation:history">) =>
    invokeCommand("conversation:history", request),
  laneList: (request: IpcRequest<"lane:list">) =>
    invokeCommand("lane:list", request),
  laneEnsure: (request: IpcRequest<"lane:ensure">) =>
    invokeCommand("lane:ensure", request),
  modelsList: () => invokeCommand("models:list", {}),
  laneOpen: (request: IpcRequest<"lane:open">) =>
    invokeCommand("lane:open", request),
  laneSendTurn: (request: IpcRequest<"lane:sendTurn">) =>
    invokeCommand("lane:sendTurn", request),
  runCancel: (request: IpcRequest<"run:cancel">) =>
    invokeCommand("run:cancel", request),
  approvalResolve: (request: IpcRequest<"approval:resolve">) =>
    invokeCommand("approval:resolve", request),
  quickChatCreate: (request: IpcRequest<"quickChat:create">) =>
    invokeCommand("quickChat:create", request),
  quickChatSend: (request: IpcRequest<"quickChat:send">) =>
    invokeCommand("quickChat:send", request),
  usageOverview: () => invokeCommand("usage:overview", {}),
  usageRefresh: () => invokeCommand("usage:refresh", {}),
  usageAlertSet: (request: IpcRequest<"usage:alertSet">) =>
    invokeCommand("usage:alertSet", request),
  memoryConfigure: (request: IpcRequest<"memory:configure">) =>
    invokeCommand("memory:configure", request),
  memoryList: () => invokeCommand("memory:list", {}),
  memorySearch: (request: IpcRequest<"memory:search">) =>
    invokeCommand("memory:search", request),
  memoryReindex: (request: IpcRequest<"memory:reindex">) =>
    invokeCommand("memory:reindex", request),
  calendarSourcesList: () => invokeCommand("calendar:sources:list", {}),
  calendarSourceCreateLocal: (
    request: IpcRequest<"calendar:source:createLocal">,
  ) => invokeCommand("calendar:source:createLocal", request),
  calendarSourceCreateLinked: (
    request: IpcRequest<"calendar:source:createLinked">,
  ) => invokeCommand("calendar:source:createLinked", request),
  calendarEventsList: (request: IpcRequest<"calendar:events:list"> = {}) =>
    invokeCommand("calendar:events:list", request),
  calendarEventCreateLocal: (
    request: IpcRequest<"calendar:event:createLocal">,
  ) => invokeCommand("calendar:event:createLocal", request),
  calendarEventUpdateLocal: (
    request: IpcRequest<"calendar:event:updateLocal">,
  ) => invokeCommand("calendar:event:updateLocal", request),
  calendarEventDeleteLocal: (
    request: IpcRequest<"calendar:event:deleteLocal">,
  ) => invokeCommand("calendar:event:deleteLocal", request),
  inboxAccountsList: () => invokeCommand("inbox:accounts:list", {}),
  inboxAccountAdd: (request: IpcRequest<"inbox:account:add">) =>
    invokeCommand("inbox:account:add", request),
  inboxAccountRemove: (request: IpcRequest<"inbox:account:remove">) =>
    invokeCommand("inbox:account:remove", request),
  inboxAccountSync: (request: IpcRequest<"inbox:account:sync">) =>
    invokeCommand("inbox:account:sync", request),
  inboxAccountUpdateCredential: (
    request: IpcRequest<"inbox:account:updateCredential">,
  ) => invokeCommand("inbox:account:updateCredential", request),
  inboxAccountConnectGoogle: () =>
    invokeCommand("inbox:account:connectGoogle", {}),
  inboxAccountReauthorizeGoogle: (
    request: IpcRequest<"inbox:account:reauthorizeGoogle">,
  ) => invokeCommand("inbox:account:reauthorizeGoogle", request),
  inboxAccountOutgoingGet: (
    request: IpcRequest<"inbox:account:outgoing:get">,
  ) => invokeCommand("inbox:account:outgoing:get", request),
  inboxAccountOutgoingSet: (
    request: IpcRequest<"inbox:account:outgoing:set">,
  ) => invokeCommand("inbox:account:outgoing:set", request),
  inboxThreadsList: (request: IpcRequest<"inbox:threads:list"> = {}) =>
    invokeCommand("inbox:threads:list", request),
  inboxThreadGet: (request: IpcRequest<"inbox:thread:get">) =>
    invokeCommand("inbox:thread:get", request),
  inboxThreadMarkRead: (request: IpcRequest<"inbox:thread:markRead">) =>
    invokeCommand("inbox:thread:markRead", request),
  inboxThreadMarkUnread: (request: IpcRequest<"inbox:thread:markUnread">) =>
    invokeCommand("inbox:thread:markUnread", request),
  inboxThreadMoveToSpam: (request: IpcRequest<"inbox:thread:moveToSpam">) =>
    invokeCommand("inbox:thread:moveToSpam", request),
  inboxThreadMoveToTrash: (request: IpcRequest<"inbox:thread:moveToTrash">) =>
    invokeCommand("inbox:thread:moveToTrash", request),
  inboxThreadCreateTask: (request: IpcRequest<"inbox:thread:createTask">) =>
    invokeCommand("inbox:thread:createTask", request),
  inboxThreadCreateReplyDraft: (
    request: IpcRequest<"inbox:thread:createReplyDraft">,
  ) => invokeCommand("inbox:thread:createReplyDraft", request),
  inboxThreadCreateForwardDraft: (
    request: IpcRequest<"inbox:thread:createForwardDraft">,
  ) => invokeCommand("inbox:thread:createForwardDraft", request),
  inboxThreadGenerateReplyDraft: (
    request: IpcRequest<"inbox:thread:generateReplyDraft">,
  ) => invokeCommand("inbox:thread:generateReplyDraft", request),
  inboxThreadAnalyze: (request: IpcRequest<"inbox:thread:analyze">) =>
    invokeCommand("inbox:thread:analyze", request),
  inboxThreadReplyActionsList: (
    request: IpcRequest<"inbox:thread:replyActions:list">,
  ) => invokeCommand("inbox:thread:replyActions:list", request),
  inboxReplyDiscard: (request: IpcRequest<"inbox:reply:discard">) =>
    invokeCommand("inbox:reply:discard", request),
  inboxReplyApproveAndSend: (
    request: IpcRequest<"inbox:reply:approveAndSend">,
  ) => invokeCommand("inbox:reply:approveAndSend", request),
} as const;
