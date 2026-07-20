import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderTree, Globe, SquareTerminal, Sparkle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { workbenchApi, type WorkbenchApi } from "./api";
import { modelDetail, modelLabel } from "./ModelPicker";
import { ResizeHandle, useResizablePane } from "../../app/layout/ResizeHandle";
import { UsageToolbarChip } from "../usage/UsageToolbarChip";
import { FileOpenContext } from "./file-open";
import { WorkspacePanel, type WorkspacePanelMode } from "./WorkspacePanel";
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
  const slashCommandsByLane = useWorkbenchStore(
    (state) => state.slashCommandsByLane,
  );
  const lastUsageByLane = useWorkbenchStore((state) => state.lastUsageByLane);
  const storeActions = useWorkbenchStore(useShallow(workbenchActions));
  const [panelMode, setPanelMode] = useState<WorkspacePanelMode | null>(null);
  const [panelFile, setPanelFile] = useState<string | null>(null);
  const panelPane = useResizablePane({
    storageKey: "okami.width.panel",
    initial: 420,
    min: 260,
    max: 900,
  });

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
  const historyQuery = useQuery({
    queryKey: ["workbench", "history", effectiveTaskId],
    queryFn: () => api.history({ taskId: effectiveTaskId! }),
    enabled: effectiveTaskId !== null,
    staleTime: Infinity,
  });
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
  const context = selectedLane
    ? sessionContext(lastUsageByLane[selectedLane.laneId], selectedLane.model)
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
        at: new Date().toISOString(),
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

  // Restores the persisted conversation once per task; an empty history never
  // clobbers a conversation already streaming live.
  const historyData = historyQuery.data;
  const hydratedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!historyData || effectiveTaskId === null) return;
    if (hydratedTaskRef.current === effectiveTaskId) return;
    const isTaskSwitch = hydratedTaskRef.current !== null;
    hydratedTaskRef.current = effectiveTaskId;
    if (
      !isTaskSwitch &&
      historyData.userMessages.length === 0 &&
      historyData.events.length === 0
    )
      return;
    storeActions.hydrateConversation(
      historyData.userMessages.map((message) => ({
        id: message.id,
        body: message.body,
        laneId: message.laneId ?? "",
        at: message.at,
      })),
      historyData.events,
    );
  }, [historyData, effectiveTaskId, storeActions]);

  // A running turn only gates the lane it belongs to.
  const laneActiveRunId =
    activeRunLaneId !== null && activeRunLaneId === selectedLane?.laneId
      ? activeRunId
      : null;
  const composer = (
    <Composer
      key={effectiveTaskId ?? "no-task"}
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
      contextNote={context?.label ?? null}
      contextPercent={context?.percent ?? null}
      draftKey={effectiveTaskId}
      slashCommands={
        selectedLane ? (slashCommandsByLane[selectedLane.laneId] ?? []) : []
      }
      onPickFiles={async () => {
        const picked = await api.pickFiles(
          selectedTask?.workspacePath
            ? { defaultPath: selectedTask.workspacePath }
            : {},
        );
        return picked.paths;
      }}
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

  // Clicking a path anywhere in the conversation opens it in the viewer.
  const fileOpener = {
    workspacePath: selectedTask?.workspacePath ?? null,
    open: (relative: string) => {
      setPanelFile(relative);
      setPanelMode("files");
    },
  };

  const panelToggle = (mode: WorkspacePanelMode) => (
    <button
      className="chat-topbar__tool"
      data-active={panelMode === mode || undefined}
      onClick={() => setPanelMode((value) => (value === mode ? null : mode))}
      title={
        mode === "files"
          ? "Arquivos da pasta"
          : mode === "browser"
            ? "Navegador embutido"
            : "Terminal na pasta"
      }
      type="button"
    >
      {mode === "files" ? (
        <FolderTree aria-hidden="true" size={14} />
      ) : mode === "browser" ? (
        <Globe aria-hidden="true" size={14} />
      ) : (
        <SquareTerminal aria-hidden="true" size={14} />
      )}
    </button>
  );

  return (
    <section
      aria-label={selectedTask?.title ?? "Conversa"}
      className="chat-view"
    >
      <div className="chat-topbar">
        <strong>{selectedTask?.title ?? "Conversa"}</strong>
        {selectedTask?.workspacePath && (
          <span className="chat-topbar__path">
            {selectedTask.workspacePath}
          </span>
        )}
        {selectedLane && (
          <>
            <span
              aria-hidden="true"
              className={`route-dot route-dot--${selectedLane.routeKind}`}
            />
            <span>{modelLabel(selectedLane)}</span>
          </>
        )}
        <span className="chat-topbar__spacer" />
        <UsageToolbarChip />
        {panelToggle("files")}
        {panelToggle("terminal")}
        {panelToggle("browser")}
      </div>
      <div className="chat-split">
        <div className="chat-workarea">
          <div className="chat-scroll">
            <div className="chat-column">
              <FileOpenContext.Provider value={fileOpener}>
                <Conversation
                  initialEvents={historyData?.events ?? []}
                  isRunning={laneActiveRunId !== null}
                  key={effectiveTaskId ?? "none"}
                  lane={selectedLane}
                  lanes={lanes}
                />
              </FileOpenContext.Provider>
            </div>
          </div>
          <div className="chat-composer-dock">{composer}</div>
        </div>
        {panelMode && effectiveTaskId && (
          <ResizeHandle
            ariaLabel="Redimensionar o painel de trabalho"
            edge="left"
            pane={panelPane}
          />
        )}
        {panelMode && effectiveTaskId && (
          <WorkspacePanel
            mode={panelMode}
            onClose={() => setPanelMode(null)}
            onOpenFile={setPanelFile}
            openFile={panelFile}
            taskId={effectiveTaskId}
            width={panelPane.width}
          />
        )}
      </div>
    </section>
  );
}

function sessionContext(
  usage:
    | {
        inputTokens: number;
        cacheReadTokens: number;
        outputTokens: number;
        contextWindow: number | null;
      }
    | undefined,
  model: string,
): { label: string; percent: number | null } | null {
  if (!usage) return null;
  const used = usage.inputTokens + usage.cacheReadTokens + usage.outputTokens;
  if (used === 0) return null;
  const window = usage.contextWindow
    ? usage.contextWindow
    : model.includes("[1m]")
      ? 1_000_000
      : /claude|opus|sonnet|haiku|default/iu.test(model)
        ? 200_000
        : null;
  const compact = (value: number) =>
    value >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`;
  if (!window) {
    return { label: `contexto ~${compact(used)} tokens`, percent: null };
  }
  const percent = Math.min(100, Math.round((used / window) * 100));
  return { label: `${compact(used)}/${compact(window)} tokens`, percent };
}

function workbenchActions(state: WorkbenchState) {
  return {
    addSentMessage: state.addSentMessage,
    applyEvent: state.applyEvent,
    cancelActiveRun: state.cancelActiveRun,
    selectLane: state.selectLane,
    setEffort: state.setEffort,
    hydrateConversation: state.hydrateConversation,
    selectTask: state.selectTask,
    setActiveRun: state.setActiveRun,
    upsertLane: state.upsertLane,
  };
}

function queryError(error: unknown): Error | null {
  return error instanceof Error ? error : null;
}
