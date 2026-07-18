import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { WorkbenchLane } from "./api";

export type WorkbenchRunStatus =
  "running" | "completed" | "failed" | "cancelled";

export interface SentMessage {
  body: string;
  id: string;
  laneId: string;
}

export interface WorkbenchState {
  activeRunId: string | null;
  appliedEventIds: Record<string, true>;
  openedLanes: Record<string, WorkbenchLane>;
  runStatus: Record<string, WorkbenchRunStatus>;
  selectedLaneId: string | null;
  selectedTaskId: string | null;
  sentMessages: SentMessage[];
  streams: Record<string, string>;
  addSentMessage(message: SentMessage): void;
  applyEvent(event: CanonicalEvent): void;
  cancelActiveRun(runId: string): void;
  selectLane(laneId: string | null): void;
  selectTask(taskId: string): void;
  setActiveRun(runId: string): void;
  upsertLane(lane: WorkbenchLane): void;
}

export function reduceCanonicalEvent(
  state: WorkbenchState,
  event: CanonicalEvent,
): WorkbenchState {
  if (state.appliedEventIds[event.id]) return state;
  const next = {
    ...state,
    appliedEventIds: { ...state.appliedEventIds, [event.id]: true as const },
  };
  if (event.kind === "message_delta") {
    const key = `${event.runId}:${String(event.nativeEventId)}`;
    next.streams = {
      ...state.streams,
      [key]: `${state.streams[key] ?? ""}${String(event.payload.delta ?? "")}`,
    };
  }
  if (event.kind === "run_completed" || event.kind === "run_failed") {
    next.runStatus = {
      ...state.runStatus,
      [event.runId]: event.kind === "run_completed" ? "completed" : "failed",
    };
  }
  return next;
}

export function createWorkbenchStore(): StoreApi<WorkbenchState> {
  return createStore<WorkbenchState>((set) => ({
    activeRunId: null,
    appliedEventIds: {},
    openedLanes: {},
    runStatus: {},
    selectedLaneId: null,
    selectedTaskId: null,
    sentMessages: [],
    streams: {},
    addSentMessage: (message) =>
      set((state) => ({ sentMessages: [...state.sentMessages, message] })),
    applyEvent: (event) => set((state) => reduceCanonicalEvent(state, event)),
    cancelActiveRun: (runId) =>
      set((state) => ({
        activeRunId: state.activeRunId === runId ? null : state.activeRunId,
        runStatus: { ...state.runStatus, [runId]: "cancelled" },
      })),
    selectLane: (laneId) => set({ selectedLaneId: laneId }),
    selectTask: (taskId) =>
      set({ selectedTaskId: taskId, selectedLaneId: null }),
    setActiveRun: (runId) =>
      set((state) => ({
        activeRunId: runId,
        runStatus: { ...state.runStatus, [runId]: "running" },
      })),
    upsertLane: (lane) =>
      set((state) => ({
        openedLanes: { ...state.openedLanes, [lane.laneId]: lane },
      })),
  }));
}

export const WorkbenchStoreContext =
  createContext<StoreApi<WorkbenchState> | null>(null);

export function useWorkbenchStore<T>(
  selector: (state: WorkbenchState) => T,
): T {
  const store = useContext(WorkbenchStoreContext);
  if (!store) throw new Error("WorkbenchStoreContext ausente");
  return useStore(store, selector);
}
