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
  at: string;
}

export interface StreamEntry {
  text: string;
  laneId: string;
  at: string;
}

export interface SessionUsage {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  contextWindow: number | null;
}

export interface WorkbenchState {
  activeRunId: string | null;
  activeRunLaneId: string | null;
  effortByLane: Record<string, string>;
  lastUsageByLane: Record<string, SessionUsage>;
  appliedEventIds: Record<string, true>;
  openedLanes: Record<string, WorkbenchLane>;
  runStatus: Record<string, WorkbenchRunStatus>;
  selectedLaneId: string | null;
  selectedTaskId: string | null;
  sentMessages: SentMessage[];
  slashCommandsByLane: Record<string, string[]>;
  streams: Record<string, StreamEntry>;
  addSentMessage(message: SentMessage): void;
  applyEvent(event: CanonicalEvent): void;
  cancelActiveRun(runId: string): void;
  selectLane(laneId: string | null): void;
  setEffort(laneId: string, effort: string): void;
  hydrateConversation(messages: SentMessage[], events: CanonicalEvent[]): void;
  selectTask(taskId: string | null): void;
  setActiveRun(runId: string, laneId: string): void;
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
    const anchor = event.payload.messageAnchor ?? event.nativeEventId;
    const key = `${event.runId}:${String(anchor)}`;
    const existing = state.streams[key];
    next.streams = {
      ...state.streams,
      [key]: {
        text: `${existing?.text ?? ""}${String(event.payload.delta ?? "")}`,
        // Attribution is frozen at stream time so switching models later
        // never relabels what another model produced.
        laneId: existing?.laneId ?? event.laneId,
        at: existing?.at ?? event.occurredAt,
      },
    };
  }
  if (event.kind === "run_completed" || event.kind === "run_failed") {
    next.runStatus = {
      ...state.runStatus,
      [event.runId]: event.kind === "run_completed" ? "completed" : "failed",
    };
    if (state.activeRunId === event.runId) {
      next.activeRunId = null;
      next.activeRunLaneId = null;
    }
  }
  if (event.kind === "session_started" || event.kind === "session_resumed") {
    const commands = event.payload.slashCommands;
    if (Array.isArray(commands)) {
      const names = commands.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
      if (names.length > 0) {
        next.slashCommandsByLane = {
          ...state.slashCommandsByLane,
          [event.laneId]: names,
        };
      }
    }
  }
  if (event.kind === "session_started") {
    // A fresh session (not a resume) is the only thing that empties context.
    const rest = Object.fromEntries(
      Object.entries(state.lastUsageByLane).filter(
        ([laneId]) => laneId !== event.laneId,
      ),
    );
    next.lastUsageByLane = rest;
    persistUsage(rest);
  }
  if (event.kind === "usage_reported") {
    const usage = event.payload.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage === "object") {
      const toCount = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? value : 0;
      const modelUsage = event.payload.modelUsage as
        Record<string, { contextWindow?: unknown }> | undefined;
      const contextWindow = modelUsage
        ? Object.values(modelUsage)
            .map((entry) =>
              typeof entry?.contextWindow === "number"
                ? entry.contextWindow
                : 0,
            )
            .reduce((max, value) => Math.max(max, value), 0) || null
        : null;
      const previous = state.lastUsageByLane[event.laneId];
      const measured =
        toCount(usage.input_tokens) +
        toCount(usage.cache_read_input_tokens) +
        toCount(usage.output_tokens);
      const previousTotal = previous
        ? previous.inputTokens +
          previous.cacheReadTokens +
          previous.outputTokens
        : 0;
      // Turn-level usage fluctuates with caching; the session's occupancy is
      // the peak, which is why the meter used to jump back down every turn.
      const keepPrevious = measured < previousTotal;
      const merged = {
        inputTokens: keepPrevious
          ? previous!.inputTokens
          : toCount(usage.input_tokens),
        cacheReadTokens: keepPrevious
          ? previous!.cacheReadTokens
          : toCount(usage.cache_read_input_tokens),
        outputTokens: keepPrevious
          ? previous!.outputTokens
          : toCount(usage.output_tokens),
        contextWindow: contextWindow ?? previous?.contextWindow ?? null,
      };
      next.lastUsageByLane = {
        ...state.lastUsageByLane,
        [event.laneId]: merged,
      };
      persistUsage(next.lastUsageByLane);
    }
  }
  return next;
}

const EFFORT_STORAGE_KEY = "okami.effortByLane";
const USAGE_STORAGE_KEY = "okami.usageByLane";

function loadPersistedUsage(): Record<string, SessionUsage> {
  try {
    const raw = globalThis.localStorage?.getItem(USAGE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, SessionUsage>;
  } catch {
    return {};
  }
}

function persistUsage(usage: Record<string, SessionUsage>): void {
  try {
    globalThis.localStorage?.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // Persistence is best effort; the in-memory meter still works.
  }
}

function loadPersistedEfforts(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(EFFORT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function persistEfforts(efforts: Record<string, string>): void {
  try {
    globalThis.localStorage?.setItem(
      EFFORT_STORAGE_KEY,
      JSON.stringify(efforts),
    );
  } catch {
    // Persistence is best effort; the in-memory selection still applies.
  }
}

export function createWorkbenchStore(): StoreApi<WorkbenchState> {
  return createStore<WorkbenchState>((set) => ({
    activeRunId: null,
    activeRunLaneId: null,
    effortByLane: loadPersistedEfforts(),
    lastUsageByLane: loadPersistedUsage(),
    appliedEventIds: {},
    openedLanes: {},
    runStatus: {},
    selectedLaneId: null,
    selectedTaskId: null,
    sentMessages: [],
    slashCommandsByLane: {},
    streams: {},
    addSentMessage: (message) =>
      set((state) => ({ sentMessages: [...state.sentMessages, message] })),
    applyEvent: (event) => set((state) => reduceCanonicalEvent(state, event)),
    cancelActiveRun: (runId) =>
      set((state) => ({
        activeRunId: state.activeRunId === runId ? null : state.activeRunId,
        activeRunLaneId:
          state.activeRunId === runId ? null : state.activeRunLaneId,
        runStatus: { ...state.runStatus, [runId]: "cancelled" },
      })),
    selectLane: (laneId) => set({ selectedLaneId: laneId }),
    hydrateConversation: (messages, events) =>
      set((state) => {
        let next: WorkbenchState = {
          ...state,
          // lastUsageByLane survives: the context meter belongs to the lane,
          // not to the message list being replaced.
          sentMessages: messages,
          streams: {},
          appliedEventIds: {},
          runStatus: {},
          activeRunId: null,
          activeRunLaneId: null,
        };
        for (const event of events) next = reduceCanonicalEvent(next, event);
        return next;
      }),
    setEffort: (laneId, effort) =>
      set((state) => {
        const effortByLane = { ...state.effortByLane, [laneId]: effort };
        persistEfforts(effortByLane);
        return { effortByLane };
      }),
    selectTask: (taskId) =>
      set({ selectedTaskId: taskId, selectedLaneId: null }),
    setActiveRun: (runId, laneId) =>
      set((state) => ({
        activeRunId: runId,
        activeRunLaneId: laneId,
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
