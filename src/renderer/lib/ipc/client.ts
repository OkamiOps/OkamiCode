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
