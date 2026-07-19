import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkle } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { workbenchApi, type WorkbenchApi } from "./api";
import { modelDetail, modelLabel } from "./ModelPicker";
import { useWorkbenchStore, type WorkbenchState } from "./store";

interface WorkbenchPageProps {
  api?: WorkbenchApi;
}

export function WorkbenchPage({ api = workbenchApi }: WorkbenchPageProps) {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const selectedLaneId = useWorkbenchStore((state) => state.selectedLaneId);
  const openedLanes = useWorkbenchStore((state) => state.openedLanes);
  const activeRunId = useWorkbenchStore((state) => state.activeRunId);
  const activeRunLaneId = useWorkbenchStore((state) => state.activeRunLaneId);
  const sentMessages = useWorkbenchStore((state) => state.sentMessages);
  const streams = useWorkbenchStore((state) => state.streams);
  const effortByLane = useWorkbenchStore((state) => state.effortByLane);
  const lastUsageByLane = useWorkbenchStore((state) => state.lastUsageByLane);
  const storeActions = useWorkbenchStore(useShallow(workbenchActions));

  const tasksQuery = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: api.listTasks,
  });
  const modelsQuery = useQuery({
    queryKey: ["workbench", "models"],
    queryFn: api.listModels,
  });
  const tasks = tasksQuery.data ?? [];
  const effectiveTaskId = selectedTaskId ?? tasks[0]?.id ?? null;
  const lanesQuery = useQuery({
    queryKey: ["workbench", "lanes", effectiveTaskId],
    queryFn: () => api.listLanes(effectiveTaskId ?? undefined),
    enabled: effectiveTaskId !== null,
  });
  const lanes = (lanesQuery.data ?? []).map(
    (lane) => openedLanes[lane.laneId] ?? lane,
  );
  const effectiveLaneId = selectedLaneId ?? lanes[0]?.laneId ?? null;
  const selectedLane =
    lanes.find((lane) => lane.laneId === effectiveLaneId) ??
    (effectiveLaneId ? (openedLanes[effectiveLaneId] ?? null) : null);
  const selectedTask =
    tasks.find((task) => task.id === effectiveTaskId) ?? null;
  const hasConversation =
    sentMessages.length > 0 || Object.keys(streams).length > 0;
  // Bridged lanes run on the Claude harness, so the catalog entry is found by
  // model id (with [1m] tolerance), never by the lane's executing runtime.
  const normalizeModelId = (id: string) => id.replace(/\[1m\]$/u, "");
  const selectedCatalogModel = selectedLane
    ? (modelsQuery.data ?? [])
        .flatMap((entry) => entry.models)
        .find(
          (model) =>
            normalizeModelId(model.id) === normalizeModelId(selectedLane.model),
        )
    : undefined;
  const efforts = selectedCatalogModel?.efforts ?? [];
  const effort = selectedLane
    ? (effortByLane[selectedLane.laneId] ??
      selectedCatalogModel?.defaultEffort ??
      (efforts.length > 0 ? efforts[Math.min(2, efforts.length - 1)] : null))
    : null;
  const contextNote = selectedLane
    ? sessionContextNote(
        lastUsageByLane[selectedLane.laneId],
        selectedLane.model,
      )
    : null;

  const openLane = useMutation({
    mutationFn: api.openLane,
    onSuccess: (lane) => {
      storeActions.upsertLane(lane);
      storeActions.selectLane(lane.laneId);
    },
  });
  const ensureLane = useMutation({
    mutationFn: api.ensureLane,
    onSuccess: (lane) => {
      storeActions.upsertLane(lane);
      storeActions.selectLane(lane.laneId);
    },
  });
  const sendTurn = useMutation({
    mutationFn: api.sendTurn,
    onSuccess: (run, request) => {
      storeActions.addSentMessage({
        body: request.input,
        id: `${run.runId}:user`,
        laneId: request.laneId,
      });
      storeActions.setActiveRun(run.runId, request.laneId);
    },
  });
  const cancelRun = useMutation({
    mutationFn: api.cancelRun,
    onSuccess: (result) => {
      if (result.cancelled) storeActions.cancelActiveRun(result.runId);
    },
  });

  useEffect(() => api.subscribe(storeActions.applyEvent), [api, storeActions]);

  // A running turn only gates the lane it belongs to.
  const laneActiveRunId =
    activeRunLaneId !== null && activeRunLaneId === selectedLane?.laneId
      ? activeRunId
      : null;
  const composer = (
    <Composer
      activeRunId={laneActiveRunId}
      error={queryError(
        sendTurn.error ?? cancelRun.error ?? openLane.error ?? ensureLane.error,
      )}
      isCancelling={cancelRun.isPending}
      isOpeningLane={openLane.isPending || ensureLane.isPending}
      isSending={sendTurn.isPending}
      lane={selectedLane}
      catalog={modelsQuery.data ?? []}
      effort={efforts.length > 0 ? effort : null}
      efforts={efforts}
      contextNote={contextNote}
      onSelectEffort={(nextEffort) => {
        if (selectedLane)
          storeActions.setEffort(selectedLane.laneId, nextEffort);
      }}
      onCancel={async (runId) => {
        await cancelRun.mutateAsync({ runId });
      }}
      onSelectModel={(runtimeKind, model) => {
        if (!effectiveTaskId) return;
        ensureLane.mutate({ taskId: effectiveTaskId, runtimeKind, model });
      }}
      onSend={async (input) => {
        if (!selectedLane) return;
        await sendTurn.mutateAsync({
          laneId: selectedLane.laneId,
          input,
          ...(efforts.length > 0 && effort ? { effort } : {}),
        });
      }}
    />
  );

  if (!hasConversation) {
    return (
      <section aria-label="Nova conversa" className="chat-view">
        <div className="chat-topbar">
          {selectedLane && (
            <>
              <span
                aria-hidden="true"
                className={`route-dot route-dot--${selectedLane.routeKind}`}
              />
              <strong>{modelLabel(selectedLane)}</strong>
              <span>{modelDetail(selectedLane)}</span>
            </>
          )}
        </div>
        <div className="chat-greeting">
          <h1>
            <Sparkle aria-hidden="true" size={26} />O que vem a seguir, Marcos?
          </h1>
          {composer}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={selectedTask?.title ?? "Conversa"}
      className="chat-view"
    >
      <div className="chat-topbar">
        <strong>{selectedTask?.title ?? "Conversa"}</strong>
        {selectedLane && (
          <>
            <span
              aria-hidden="true"
              className={`route-dot route-dot--${selectedLane.routeKind}`}
            />
            <span>{modelLabel(selectedLane)}</span>
          </>
        )}
      </div>
      <div className="chat-scroll">
        <div className="chat-column">
          <Conversation lane={selectedLane} />
        </div>
      </div>
      <div className="chat-composer-dock">
        {laneActiveRunId && (
          <div className="chat-status-line">
            <span aria-hidden="true" className="pulse" />
            Executando…
          </div>
        )}
        {composer}
      </div>
    </section>
  );
}

function sessionContextNote(
  usage:
    | { inputTokens: number; cacheReadTokens: number; outputTokens: number }
    | undefined,
  model: string,
): string | null {
  if (!usage) return null;
  const used = usage.inputTokens + usage.cacheReadTokens + usage.outputTokens;
  if (used === 0) return null;
  const window = model.includes("[1m]")
    ? 1_000_000
    : /claude|opus|sonnet|haiku|default/iu.test(model)
      ? 200_000
      : null;
  const compact = (value: number) =>
    value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`;
  if (!window) return `contexto ~${compact(used)} tokens`;
  const percent = Math.min(100, Math.round((used / window) * 100));
  return `contexto ${percent}% · ${compact(used)}/${compact(window)}`;
}

function workbenchActions(state: WorkbenchState) {
  return {
    addSentMessage: state.addSentMessage,
    applyEvent: state.applyEvent,
    cancelActiveRun: state.cancelActiveRun,
    selectLane: state.selectLane,
    setEffort: state.setEffort,
    selectTask: state.selectTask,
    setActiveRun: state.setActiveRun,
    upsertLane: state.upsertLane,
  };
}

function queryError(error: unknown): Error | null {
  return error instanceof Error ? error : null;
}
