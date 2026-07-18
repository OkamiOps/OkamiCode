import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { subscribeToWorkbenchEvents } from "../../lib/ipc/events";

export type WorkbenchTask = IpcResponse<"task:list">[number];
export type WorkbenchLane = IpcResponse<"lane:list">[number];

export interface WorkbenchApi {
  cancelRun(
    request: IpcRequest<"run:cancel">,
  ): Promise<IpcResponse<"run:cancel">>;
  listLanes(taskId?: string): Promise<IpcResponse<"lane:list">>;
  listTasks(): Promise<IpcResponse<"task:list">>;
  openLane(request: IpcRequest<"lane:open">): Promise<IpcResponse<"lane:open">>;
  sendTurn(
    request: IpcRequest<"lane:sendTurn">,
  ): Promise<IpcResponse<"lane:sendTurn">>;
  subscribe(listener: (event: CanonicalEvent) => void): () => void;
}

export const workbenchApi: WorkbenchApi = {
  cancelRun: (request) => workbenchClient.runCancel(request),
  listLanes: (taskId) => workbenchClient.laneList(taskId ? { taskId } : {}),
  listTasks: () => workbenchClient.taskList(),
  openLane: (request) => workbenchClient.laneOpen(request),
  sendTurn: (request) => workbenchClient.laneSendTurn(request),
  subscribe: subscribeToWorkbenchEvents,
};
