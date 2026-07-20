import type { z } from "zod";
import {
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

function invokeCommand<C extends IpcChannel>(
  channel: C,
  args: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const schema = ipcResponseSchemas[channel] as unknown as z.ZodType<
    IpcResponse<C>
  >;
  return invokeParsed(channel, args, schema);
}

export const workbenchClient = {
  systemDoctor: () => invokeCommand("system:doctor", {}),
  taskCreate: (request: IpcRequest<"task:create">) =>
    invokeCommand("task:create", request),
  taskList: () => invokeCommand("task:list", {}),
  taskRename: (request: IpcRequest<"task:rename">) =>
    invokeCommand("task:rename", request),
  taskDelete: (request: IpcRequest<"task:delete">) =>
    invokeCommand("task:delete", request),
  filePick: (request: IpcRequest<"file:pick">) =>
    invokeCommand("file:pick", request),
  fsList: (request: IpcRequest<"fs:list">) => invokeCommand("fs:list", request),
  fsRead: (request: IpcRequest<"fs:read">) => invokeCommand("fs:read", request),
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
  ecoMcp: (request: IpcRequest<"eco:mcp">) => invokeCommand("eco:mcp", request),
  ecoSkills: () => invokeCommand("eco:skills", {}),
  ecoMemoryList: (request: IpcRequest<"eco:memoryList">) =>
    invokeCommand("eco:memoryList", request),
  ecoMemoryRead: (request: IpcRequest<"eco:memoryRead">) =>
    invokeCommand("eco:memoryRead", request),
  ecoMemoryWrite: (request: IpcRequest<"eco:memoryWrite">) =>
    invokeCommand("eco:memoryWrite", request),
  ecoSettings: () => invokeCommand("eco:settings", {}),
  workspacePick: () => invokeCommand("workspace:pick", {}),
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
  memorySearch: (request: IpcRequest<"memory:search">) =>
    invokeCommand("memory:search", request),
  memoryReindex: (request: IpcRequest<"memory:reindex">) =>
    invokeCommand("memory:reindex", request),
} as const;
