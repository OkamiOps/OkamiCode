import { randomUUID } from "node:crypto";

export type TaskId = string & { readonly __brand: "TaskId" };
export type LaneId = string & { readonly __brand: "LaneId" };
export type RunId = string & { readonly __brand: "RunId" };

export const newTaskId = () => randomUUID() as TaskId;
export const newLaneId = () => randomUUID() as LaneId;
export const newRunId = () => randomUUID() as RunId;
