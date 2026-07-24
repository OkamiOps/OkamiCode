import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { WorkbenchLane } from "./api";
import type { RuntimeIdentity } from "./runtime-presentation";

export type WorkbenchRunStatus =
  "running" | "completed" | "failed" | "cancelled";

export interface SentMessage {
  body: string;
  id: string;
  laneId: string;
  at: string;
}

export interface StreamEntry extends Partial<RuntimeIdentity> {
  text: string;
  laneId: string;
  at: string;
}

export interface SessionUsage {
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** Occupancy from a dedicated runtime reading, never aggregate billing. */
  contextTokens: number | null;
  contextWindow: number | null;
}

export interface WorkbenchState {
  activeRunId: string | null;
  activeRunLaneId: string | null;
  runningRuns: Record<string, string>;
  unreadByLane: Record<string, number>;
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
  markLanesRead(laneIds: string[]): void;
  selectTask(taskId: string | null): void;
  setActiveRun(runId: string, laneId: string): void;
  upsertLane(lane: WorkbenchLane): void;
}

const LIVE_ACTIVITY_KINDS = new Set<CanonicalEvent["kind"]>([
  "session_started",
  "session_resumed",
  "message_delta",
  "message_completed",
  "tool_call_started",
  "tool_call_updated",
  "tool_call_completed",
  "approval_requested",
  "approval_resolved",
  "subagent_started",
  "subagent_completed",
]);

export function reduceCanonicalEvent(
  state: WorkbenchState,
  event: CanonicalEvent,
  options: { trackActivity?: boolean } = {},
): WorkbenchState {
  if (state.appliedEventIds[event.id]) return state;
  const next = {
    ...state,
    appliedEventIds: { ...state.appliedEventIds, [event.id]: true as const },
  };
  if (options.trackActivity !== false && LIVE_ACTIVITY_KINDS.has(event.kind)) {
    next.runningRuns = {
      ...(state.runningRuns ?? {}),
      [event.runId]: event.laneId,
    };
  }
  if (event.kind === "message_delta") {
    const anchor = event.payload.messageAnchor ?? event.nativeEventId;
    const key = `${event.runId}:${String(anchor)}`;
    const existing = state.streams[key];
    const identity = frozenStreamIdentity(
      existing,
      state.openedLanes?.[event.laneId],
    );
    next.streams = {
      ...state.streams,
      [key]: {
        text: `${existing?.text ?? ""}${String(event.payload.delta ?? "")}`,
        // Attribution is frozen at stream time so switching models later
        // never relabels what another model produced.
        laneId: existing?.laneId ?? event.laneId,
        at: existing?.at ?? event.occurredAt,
        ...identity,
      },
    };
  }
  if (event.kind === "message_completed") {
    const text =
      typeof event.payload.text === "string" ? event.payload.text : "";
    const runPrefix = `${event.runId}:`;
    const alreadyStreamed = Object.keys(state.streams).some((key) =>
      key.startsWith(runPrefix),
    );
    // Some native CLIs (notably AGY) return one final stdout message instead
    // of deltas. Project that completion into the same conversation stream,
    // while leaving providers that already streamed this run untouched.
    if (text.trim().length > 0 && !alreadyStreamed) {
      const anchor = event.payload.messageAnchor ?? event.nativeEventId;
      const key = `${event.runId}:${String(anchor)}`;
      const identity = frozenStreamIdentity(
        state.streams[key],
        state.openedLanes?.[event.laneId],
      );
      next.streams = {
        ...state.streams,
        [key]: {
          text,
          laneId: event.laneId,
          at: event.occurredAt,
          ...identity,
        },
      };
    }
  }
  if (
    event.kind === "run_completed" ||
    event.kind === "run_failed" ||
    event.kind === "run_cancelled"
  ) {
    const runningRuns = { ...(state.runningRuns ?? {}) };
    delete runningRuns[event.runId];
    next.runningRuns = runningRuns;
    next.runStatus = {
      ...state.runStatus,
      [event.runId]:
        event.kind === "run_completed"
          ? "completed"
          : event.kind === "run_cancelled"
            ? "cancelled"
            : "failed",
    };
    if (state.activeRunId === event.runId) {
      next.activeRunId = null;
      next.activeRunLaneId = null;
    }
    const outputIsVisible =
      event.laneId === state.selectedLaneId ||
      event.taskId === state.selectedTaskId;
    if (
      options.trackActivity !== false &&
      event.kind !== "run_cancelled" &&
      !outputIsVisible
    ) {
      next.unreadByLane = {
        ...(state.unreadByLane ?? {}),
        [event.laneId]: ((state.unreadByLane ?? {})[event.laneId] ?? 0) + 1,
      };
      persistProjectActivity(next.unreadByLane);
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
      const dedicatedContext = dedicatedContextReading(event.payload);
      const contextWindow =
        dedicatedContext?.window ??
        (modelUsage
          ? Object.values(modelUsage)
              .map((entry) =>
                typeof entry?.contextWindow === "number"
                  ? entry.contextWindow
                  : 0,
              )
              .reduce((max, value) => Math.max(max, value), 0) || null
          : null);
      const merged = {
        inputTokens: toCount(usage.input_tokens),
        cacheReadTokens: toCount(usage.cache_read_input_tokens),
        outputTokens: toCount(usage.output_tokens),
        contextTokens: dedicatedContext?.used ?? null,
        contextWindow,
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

function frozenStreamIdentity(
  existing: StreamEntry | undefined,
  lane: WorkbenchLane | undefined,
): RuntimeIdentity | Record<string, never> {
  if (
    existing?.runtimeKind &&
    existing.providerAccountLabel &&
    existing.model
  ) {
    return {
      runtimeKind: existing.runtimeKind,
      providerAccountLabel: existing.providerAccountLabel,
      model: existing.model,
    };
  }
  return lane
    ? {
        runtimeKind: lane.runtimeKind,
        providerAccountLabel: lane.providerAccountLabel,
        model: lane.model,
      }
    : {};
}

function dedicatedContextReading(
  payload: Record<string, unknown>,
): { used: number; window: number } | null {
  // Claude result usage aggregates billing across model calls and subagents.
  // Only Codex's dedicated tokenUsage notification describes one live window.
  if (payload.nativeMethod !== "thread/tokenUsage/updated") return null;
  const usage = asRecord(payload.usage);
  const tokenUsage = asRecord(usage?.tokenUsage) ?? usage;
  const total = asRecord(tokenUsage?.total);
  const used = finiteCount(total?.totalTokens ?? tokenUsage?.totalTokens);
  const window = finiteCount(
    tokenUsage?.modelContextWindow ?? usage?.modelContextWindow,
  );
  return used !== null && window !== null && window > 0
    ? { used, window }
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

const EFFORT_STORAGE_KEY = "okami.effortByLane";
const USAGE_STORAGE_KEY = "okami.usageByLane";
const PROJECT_ACTIVITY_STORAGE_KEY = "okami.code.project-activity";

function loadProjectActivity(): Record<string, number> {
  try {
    const raw = globalThis.localStorage?.getItem(PROJECT_ACTIVITY_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const unread =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as { unreadByLane?: unknown }).unreadByLane
        : null;
    if (!unread || typeof unread !== "object" || Array.isArray(unread)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(unread).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" &&
          Number.isInteger(entry[1]) &&
          entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

function persistProjectActivity(unreadByLane: Record<string, number>): void {
  try {
    globalThis.localStorage?.setItem(
      PROJECT_ACTIVITY_STORAGE_KEY,
      JSON.stringify({ unreadByLane }),
    );
  } catch {
    // Activity remains available in memory when persistence is unavailable.
  }
}

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
    runningRuns: {},
    unreadByLane: loadProjectActivity(),
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
      set((state) => {
        const runningRuns = { ...state.runningRuns };
        delete runningRuns[runId];
        return {
          activeRunId: state.activeRunId === runId ? null : state.activeRunId,
          activeRunLaneId:
            state.activeRunId === runId ? null : state.activeRunLaneId,
          runningRuns,
          runStatus: { ...state.runStatus, [runId]: "cancelled" },
        };
      }),
    selectLane: (laneId) =>
      set((state) => {
        if (!laneId || !state.unreadByLane[laneId])
          return { selectedLaneId: laneId };
        const unreadByLane = { ...state.unreadByLane };
        delete unreadByLane[laneId];
        persistProjectActivity(unreadByLane);
        return { selectedLaneId: laneId, unreadByLane };
      }),
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
        for (const event of events)
          next = reduceCanonicalEvent(next, event, { trackActivity: false });
        return next;
      }),
    markLanesRead: (laneIds) =>
      set((state) => {
        const unreadByLane = { ...state.unreadByLane };
        for (const laneId of laneIds) delete unreadByLane[laneId];
        persistProjectActivity(unreadByLane);
        return { unreadByLane };
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
        runningRuns: { ...state.runningRuns, [runId]: laneId },
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
