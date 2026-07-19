import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { subscribeToWorkbenchEvents } from "../../lib/ipc/events";

export type WorkbenchTask = IpcResponse<"task:list">[number];
export type WorkbenchLane = IpcResponse<"lane:list">[number];
export type ModelCatalog = IpcResponse<"models:list">;

export interface WorkbenchApi {
  cancelRun(
    request: IpcRequest<"run:cancel">,
  ): Promise<IpcResponse<"run:cancel">>;
  listLanes(taskId?: string): Promise<IpcResponse<"lane:list">>;
  listModels(): Promise<IpcResponse<"models:list">>;
  ensureLane(
    request: IpcRequest<"lane:ensure">,
  ): Promise<IpcResponse<"lane:ensure">>;
  listTasks(): Promise<IpcResponse<"task:list">>;
  pickWorkspace(): Promise<IpcResponse<"workspace:pick">>;
  pickFiles(
    request: IpcRequest<"file:pick">,
  ): Promise<IpcResponse<"file:pick">>;
  renameTask(
    request: IpcRequest<"task:rename">,
  ): Promise<IpcResponse<"task:rename">>;
  deleteTask(
    request: IpcRequest<"task:delete">,
  ): Promise<IpcResponse<"task:delete">>;
  createTask(
    request: IpcRequest<"task:create">,
  ): Promise<IpcResponse<"task:create">>;
  history(
    request: IpcRequest<"conversation:history">,
  ): Promise<IpcResponse<"conversation:history">>;
  openLane(request: IpcRequest<"lane:open">): Promise<IpcResponse<"lane:open">>;
  sendTurn(
    request: IpcRequest<"lane:sendTurn">,
  ): Promise<IpcResponse<"lane:sendTurn">>;
  subscribe(listener: (event: CanonicalEvent) => void): () => void;
}

export const workbenchApi: WorkbenchApi = {
  cancelRun: (request) => workbenchClient.runCancel(request),
  listLanes: (taskId) => workbenchClient.laneList(taskId ? { taskId } : {}),
  listModels: () => workbenchClient.modelsList(),
  ensureLane: (request) => workbenchClient.laneEnsure(request),
  listTasks: () => workbenchClient.taskList(),
  pickWorkspace: () => workbenchClient.workspacePick(),
  pickFiles: (request) => workbenchClient.filePick(request),
  renameTask: (request) => workbenchClient.taskRename(request),
  deleteTask: (request) => workbenchClient.taskDelete(request),
  createTask: (request) => workbenchClient.taskCreate(request),
  history: (request) => workbenchClient.conversationHistory(request),
  openLane: (request) => workbenchClient.laneOpen(request),
  sendTurn: (request) => workbenchClient.laneSendTurn(request),
  subscribe: subscribeToWorkbenchEvents,
};
