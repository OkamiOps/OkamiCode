import { useMutation, useQuery } from "@tanstack/react-query";
import {
  FileDiff,
  FolderTree,
  Globe,
  ListChecks,
  LoaderCircle,
  SquareTerminal,
  Sparkle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Composer } from "./Composer";
import { Conversation, LaneHealth } from "./Conversation";
import { workbenchApi, type WorkbenchApi } from "./api";
import { modelDetail, modelLabel } from "./ModelPicker";
import { ResizeHandle, useResizablePane } from "../../app/layout/ResizeHandle";
import { UsagePopover } from "../usage/UsagePopover";
import { ConversationMenu } from "./ConversationMenu";
import { workbenchClient } from "../../lib/ipc/client";
import { FileOpenContext } from "./file-open";
import {
  PANEL_TITLES,
  WorkspacePanel,
  type WorkspacePanelMode,
} from "./WorkspacePanel";
import { useWorkbenchStore, type WorkbenchState } from "./store";
import { providerKindForLane } from "./runtime-presentation";
import { describeSessionContext } from "./context-usage";

interface WorkbenchPageProps {
  api?: WorkbenchApi;
}

// Kept outside the component so the immutability rule sees a plain helper
// rather than a render-scope mutation.
const LAYOUT_KEY = "okami.panelLayout";

// The arrangement belongs to the user, so it survives reloads.
function loadLayout(): {
  panels: WorkspacePanelMode[];
  active: WorkspacePanelMode | null;
} {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") {
      return { panels: [], active: null };
    }
    const value = parsed as { panels?: unknown; active?: unknown };
    const allowed = new Set<WorkspacePanelMode>([
      "changes",
      "files",
      "browser",
      "terminal",
      "tasks",
    ]);
    const panels = Array.isArray(value.panels)
      ? (value.panels.filter((panel): panel is WorkspacePanelMode =>
          allowed.has(panel as WorkspacePanelMode),
        ) as WorkspacePanelMode[])
      : [];
    return {
      panels,
      active:
        typeof value.active === "string" &&
        panels.includes(value.active as WorkspacePanelMode)
          ? (value.active as WorkspacePanelMode)
          : (panels[0] ?? null),
    };
  } catch {
    return { panels: [], active: null };
  }
}

function persistLayout(
  panels: WorkspacePanelMode[],
  active: WorkspacePanelMode | null,
): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ panels, active }));
  } catch {
    // Layout persistence is a convenience, never a hard requirement.
  }
}

export function WorkbenchPage({ api = workbenchApi }: WorkbenchPageProps) {
  const navigate = useNavigate();
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const selectedLaneId = useWorkbenchStore((state) => state.selectedLaneId);
  const openedLanes = useWorkbenchStore((state) => state.openedLanes);
  const activeRunId = useWorkbenchStore((state) => state.activeRunId);
  const activeRunLaneId = useWorkbenchStore((state) => state.activeRunLaneId);
  const runningRuns = useWorkbenchStore((state) => state.runningRuns);
  const sentMessages = useWorkbenchStore((state) => state.sentMessages);
  const streams = useWorkbenchStore((state) => state.streams);
  const effortByLane = useWorkbenchStore((state) => state.effortByLane);
  const slashCommandsByLane = useWorkbenchStore(
    (state) => state.slashCommandsByLane,
  );
  const lastUsageByLane = useWorkbenchStore((state) => state.lastUsageByLane);
  const storeActions = useWorkbenchStore(useShallow(workbenchActions));
  const [initialLayout] = useState(loadLayout);
  const [openPanels, setOpenPanels] = useState<WorkspacePanelMode[]>(
    initialLayout.panels,
  );
  // The ref is the authoritative value during navigation. React may discard a
  // queued state updater when this route unmounts, but closing a panel must be
  // persisted before the user can leave the conversation.
  const openPanelsRef = useRef<WorkspacePanelMode[]>(initialLayout.panels);
  const [activePanel, setActivePanel] = useState<WorkspacePanelMode | null>(
    initialLayout.active,
  );
  const activePanelRef = useRef<WorkspacePanelMode | null>(
    initialLayout.active,
  );
  const [panelFile, setPanelFile] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const focusPanel = (mode: WorkspacePanelMode) => {
    const next = openPanelsRef.current.includes(mode)
      ? openPanelsRef.current
      : [...openPanelsRef.current, mode];
    openPanelsRef.current = next;
    activePanelRef.current = mode;
    setOpenPanels(next);
    setActivePanel(mode);
    persistLayout(next, mode);
  };
  const closePanel = (mode: WorkspacePanelMode) => {
    const next = openPanelsRef.current.filter((entry) => entry !== mode);
    const active =
      activePanelRef.current === mode
        ? (next.at(-1) ?? null)
        : activePanelRef.current;
    openPanelsRef.current = next;
    activePanelRef.current = active;
    setOpenPanels(next);
    setActivePanel(active);
    persistLayout(next, active);
  };
  const togglePanel = (mode: WorkspacePanelMode) => {
    if (activePanelRef.current === mode) {
      closePanel(mode);
      return;
    }
    focusPanel(mode);
  };
  const panelPane = useResizablePane({
    storageKey: "okami.width.panel",
    initial: 420,
    min: 260,
    // The rail can take most of the window: a browser preview needs room.
    max: 1800,
  });

  const tasksQuery = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: api.listTasks,
  });
  const modelsQuery = useQuery({
    queryKey: ["workbench", "models"],
    queryFn: api.listModels,
    refetchInterval: (query) =>
      query.state.data?.some((entry) => entry.source.startsWith("consultando"))
        ? 2_000
        : false,
  });
  const modelFavoritesQuery = useQuery({
    queryKey: ["workbench", "model-favorites"],
    queryFn: api.listModelFavorites,
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
  const skillsQuery = useQuery({
    queryKey: ["workbench", "skills", selectedTask?.workspacePath ?? null],
    queryFn: () =>
      api.listSkills(
        selectedTask?.workspacePath
          ? { workspacePath: selectedTask.workspacePath }
          : {},
      ),
  });
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
    ? describeSessionContext(
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
  const [hydratedTaskId, setHydratedTaskId] = useState<string | null>(null);
  useEffect(() => {
    if (!historyData || effectiveTaskId === null) return;
    if (hydratedTaskRef.current === effectiveTaskId) return;
    const isTaskSwitch = hydratedTaskRef.current !== null;
    hydratedTaskRef.current = effectiveTaskId;
    if (
      !isTaskSwitch &&
      historyData.userMessages.length === 0 &&
      historyData.events.length === 0
    ) {
      setHydratedTaskId(effectiveTaskId);
      return;
    }
    storeActions.hydrateConversation(
      historyData.userMessages.map((message) => ({
        id: message.id,
        body: message.body,
        laneId: message.laneId ?? "",
        at: message.at,
      })),
      historyData.events,
    );
    setHydratedTaskId(effectiveTaskId);
  }, [historyData, effectiveTaskId, storeActions]);

  // Dev-server URLs the agent printed become one-click previews, the way
  // Codex lists "Saídas".
  const suggestedUrls = [
    ...new Set(
      (historyData?.events ?? []).flatMap((event) => {
        const text = JSON.stringify(event.payload ?? {});
        return [
          ...text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)[^"\\\s]*/gu),
        ]
          .map((match) => match[0])
          .filter((url) => url.length < 120);
      }),
    ),
  ];

  // A running turn only gates the lane it belongs to.
  const laneActiveRunId =
    Object.entries(runningRuns).find(
      ([, laneId]) => laneId === selectedLane?.laneId,
    )?.[0] ??
    (activeRunLaneId !== null && activeRunLaneId === selectedLane?.laneId
      ? activeRunId
      : null);
  const activeRunLane = laneActiveRunId
    ? (lanes.find(
        (candidate) => candidate.laneId === runningRuns[laneActiveRunId],
      ) ?? selectedLane)
    : null;
  const openUrlInternally = (url: string) => {
    setPreviewUrl(url);
    focusPanel("browser");
  };
  const openUrlExternally = (url: string) => {
    void workbenchClient.systemOpenExternal({ url });
  };
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
      favorites={modelFavoritesQuery.data ?? []}
      effort={efforts.length > 0 ? effort : null}
      efforts={efforts}
      contextNote={context?.label ?? null}
      contextPercent={context?.percent ?? null}
      contextBreakdown={context?.breakdown ?? null}
      draftKey={effectiveTaskId}
      taskId={effectiveTaskId}
      skills={skillsQuery.data ?? []}
      suggestions={suggestedUrls}
      onOpenPanel={focusPanel}
      onSelectPermissionMode={(mode) => {
        if (!selectedLane) return;
        void workbenchClient
          .laneSetPermissionMode({
            laneId: selectedLane.laneId,
            mode,
          })
          .then(() => lanesQuery.refetch());
      }}
      onOpenUrl={openUrlInternally}
      onNavigate={navigate}
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

  if (
    tasksQuery.isPending ||
    (effectiveTaskId !== null &&
      (historyQuery.isPending ||
        lanesQuery.isPending ||
        hydratedTaskId !== effectiveTaskId))
  ) {
    const loadingTitle = selectedTask?.title ?? "projeto";
    return (
      <section
        aria-label={`Abrindo ${loadingTitle}`}
        className="chat-view chat-project-loading"
        role="status"
      >
        <div className="chat-project-loading__signal" aria-hidden="true">
          <LoaderCircle size={20} />
          <i />
          <i />
        </div>
        <strong>Abrindo {loadingTitle}</strong>
        <span>Sincronizando conversa e ambiente local</span>
      </section>
    );
  }

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
          <LaneHealth
            events={historyData?.events ?? []}
            isRunning={laneActiveRunId !== null}
            lane={selectedLane}
          />
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
      focusPanel("files");
    },
  };

  const panelToggle = (mode: WorkspacePanelMode) => (
    <button
      aria-pressed={activePanel === mode}
      className="chat-topbar__tool"
      data-active={activePanel === mode || undefined}
      onClick={() => togglePanel(mode)}
      title={PANEL_TITLES[mode]}
      type="button"
    >
      {mode === "changes" ? (
        <FileDiff aria-hidden="true" size={14} />
      ) : mode === "files" ? (
        <FolderTree aria-hidden="true" size={14} />
      ) : mode === "browser" ? (
        <Globe aria-hidden="true" size={14} />
      ) : mode === "tasks" ? (
        <ListChecks aria-hidden="true" size={14} />
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
        <span className="chat-topbar__identity">
          <strong>{selectedTask?.title ?? "Conversa"}</strong>
          {selectedTask?.workspacePath && (
            <span className="chat-topbar__path">
              {selectedTask.workspacePath}
            </span>
          )}
        </span>
        <span className="chat-topbar__spacer" />
        <UsagePopover
          activeProvider={
            selectedLane ? providerKindForLane(selectedLane) : null
          }
        />
        {panelToggle("changes")}
        {panelToggle("files")}
        {panelToggle("terminal")}
        {panelToggle("browser")}
        {panelToggle("tasks")}
        <ConversationMenu
          activePanels={openPanels}
          onDelete={() => {
            if (!effectiveTaskId || !selectedTask) return;
            if (
              window.confirm(
                `Apagar a conversa "${selectedTask.title}"? O histórico dela será removido.`,
              )
            ) {
              void api
                .deleteTask({ taskId: effectiveTaskId })
                .then(() => window.location.reload());
            }
          }}
          onRename={() => {
            if (!effectiveTaskId || !selectedTask) return;
            const title = window.prompt(
              "Novo nome da conversa",
              selectedTask.title,
            );
            if (title?.trim()) {
              void api
                .renameTask({ taskId: effectiveTaskId, title: title.trim() })
                .then(() => window.location.reload());
            }
          }}
          onArchive={() => {
            if (!effectiveTaskId) return;
            void workbenchClient
              .taskArchive({ taskId: effectiveTaskId, archived: true })
              .then(() => window.location.reload());
          }}
          onExport={() => {
            if (!effectiveTaskId) return;
            void workbenchClient.conversationExport({
              taskId: effectiveTaskId,
            });
          }}
          onExportAudit={() => {
            if (!effectiveTaskId || !selectedLane) return;
            void workbenchClient.auditExport({
              taskId: effectiveTaskId,
              laneId: selectedLane.laneId,
            });
          }}
          onFork={() => {
            if (!effectiveTaskId) return;
            void workbenchClient
              .taskFork({ taskId: effectiveTaskId })
              .then((task) => {
                storeActions.selectTask(task.id);
                window.location.reload();
              });
          }}
          onTogglePanel={togglePanel}
        />
      </div>
      <div className="chat-split">
        <div className="chat-workarea">
          <div className="chat-scroll">
            <div className="chat-column">
              <FileOpenContext.Provider value={fileOpener}>
                <Conversation
                  activeLane={activeRunLane}
                  initialEvents={historyData?.events ?? []}
                  isRunning={laneActiveRunId !== null}
                  key={effectiveTaskId ?? "none"}
                  lane={selectedLane}
                  lanes={lanes}
                  onOpenExternal={openUrlExternally}
                  onOpenUrl={openUrlInternally}
                />
              </FileOpenContext.Provider>
            </div>
          </div>
          <div className="chat-composer-dock">{composer}</div>
        </div>
        {activePanel && effectiveTaskId && (
          <ResizeHandle
            ariaLabel="Redimensionar o painel de trabalho"
            edge="left"
            pane={panelPane}
          />
        )}
        {activePanel && effectiveTaskId && (
          <aside
            aria-label="Painel de trabalho"
            className="workspace-rail"
            style={{ width: panelPane.width }}
          >
            <nav
              aria-label="Ferramentas abertas"
              className="workspace-rail__tabs"
            >
              {openPanels.map((mode) => (
                <button
                  data-active={activePanel === mode || undefined}
                  key={mode}
                  onClick={() => focusPanel(mode)}
                  type="button"
                >
                  {PANEL_TITLES[mode]}
                </button>
              ))}
            </nav>
            <WorkspacePanel
              initialUrl={previewUrl}
              mode={activePanel}
              onClose={() => closePanel(activePanel)}
              onOpenExternal={openUrlExternally}
              onOpenFile={setPanelFile}
              openFile={panelFile}
              taskId={effectiveTaskId}
              workspacePath={selectedTask?.workspacePath ?? null}
            />
          </aside>
        )}
      </div>
    </section>
  );
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
