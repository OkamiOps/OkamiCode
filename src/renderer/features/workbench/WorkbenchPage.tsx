import { useMutation, useQuery } from "@tanstack/react-query";
import {
  FolderTree,
  Globe,
  ListChecks,
  SquareTerminal,
  Sparkle,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
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

interface WorkbenchPageProps {
  api?: WorkbenchApi;
}

// Kept outside the component so the immutability rule sees a plain helper
// rather than a render-scope mutation.
const LAYOUT_KEY = "okami.panelLayout";

// The arrangement belongs to the user, so it survives reloads.
function loadLayout(): {
  panels: WorkspacePanelMode[];
  columns: number | null;
} {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") {
      return { panels: [], columns: null };
    }
    const value = parsed as { panels?: unknown; columns?: unknown };
    return {
      panels: Array.isArray(value.panels)
        ? (value.panels as WorkspacePanelMode[])
        : [],
      columns: typeof value.columns === "number" ? value.columns : null,
    };
  } catch {
    return { panels: [], columns: null };
  }
}

function persistLayout(
  panels: WorkspacePanelMode[],
  columns: number | null,
): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ panels, columns }));
  } catch {
    // Layout persistence is a convenience, never a hard requirement.
  }
}

function setBodySelectable(selectable: boolean): void {
  document.body.style.userSelect = selectable ? "" : "none";
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
  const [initialLayout] = useState(loadLayout);
  const [openPanels, setOpenPanels] = useState<WorkspacePanelMode[]>(
    initialLayout.panels,
  );
  // The ref is the authoritative value during navigation. React may discard a
  // queued state updater when this route unmounts, but closing a panel must be
  // persisted before the user can leave the conversation.
  const openPanelsRef = useRef<WorkspacePanelMode[]>(initialLayout.panels);
  const [panelFile, setPanelFile] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [maximizedPanel, setMaximizedPanel] =
    useState<WorkspacePanelMode | null>(null);
  // null = balanced automatically; a number pins the column count so panels
  // can stack in rows instead of always sitting side by side.
  const [panelColumns, setPanelColumns] = useState<number | null>(
    initialLayout.columns,
  );
  const [dropTarget, setDropTarget] = useState<WorkspacePanelMode | null>(null);
  // Kept in a ref so the persist helpers always see the current choice.
  const panelColumnsRef = useRef<number | null>(initialLayout.columns);
  const updateOpenPanels = (
    update: (current: WorkspacePanelMode[]) => WorkspacePanelMode[],
  ) => {
    const current = openPanelsRef.current;
    const next = update(current);
    if (next === current) return;

    openPanelsRef.current = next;
    persistLayout(next, panelColumnsRef.current);
    setOpenPanels(next);
  };
  const togglePanel = (mode: WorkspacePanelMode) =>
    updateOpenPanels((current) =>
      current.includes(mode)
        ? current.filter((entry) => entry !== mode)
        : [...current, mode],
    );

  // Dragging a panel header onto another panel swaps their slots, so the
  // arrangement is the user's rather than the order things were opened in.
  const beginPanelDrag = (source: WorkspacePanelMode) => {
    const panelUnder = (event: MouseEvent): WorkspacePanelMode | null => {
      const element = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("[data-panel]");
      const value = element?.getAttribute("data-panel");
      return (value as WorkspacePanelMode | null) ?? null;
    };
    const move = (event: MouseEvent) => {
      const target = panelUnder(event);
      setDropTarget(target && target !== source ? target : null);
    };
    const up = (event: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setBodySelectable(true);
      setDropTarget(null);
      const target = panelUnder(event);
      if (!target || target === source) return;
      updateOpenPanels((current) => {
        const next = [...current];
        const from = next.indexOf(source);
        const to = next.indexOf(target);
        if (from === -1 || to === -1) return current;
        next[from] = target;
        next[to] = source;
        return next;
      });
    };
    setBodySelectable(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
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
      contextBreakdown={context?.breakdown ?? null}
      draftKey={effectiveTaskId}
      taskId={effectiveTaskId}
      suggestions={suggestedUrls}
      onOpenPanel={(mode) =>
        updateOpenPanels((current) =>
          current.includes(mode) ? current : [...current, mode],
        )
      }
      onSelectPermissionMode={(mode) => {
        if (!selectedLane) return;
        void workbenchClient
          .laneSetPermissionMode({
            laneId: selectedLane.laneId,
            mode,
          })
          .then(() => lanesQuery.refetch());
      }}
      onOpenUrl={(url) => {
        setPreviewUrl(url);
        updateOpenPanels((current) =>
          current.includes("browser") ? current : [...current, "browser"],
        );
      }}
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
      updateOpenPanels((current) =>
        current.includes("files") ? current : [...current, "files"],
      );
    },
  };

  const panelToggle = (mode: WorkspacePanelMode) => (
    <button
      className="chat-topbar__tool"
      data-active={openPanels.includes(mode) || undefined}
      onClick={() => togglePanel(mode)}
      title={PANEL_TITLES[mode]}
      type="button"
    >
      {mode === "files" ? (
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
        <UsagePopover />
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
        {openPanels.length > 0 && effectiveTaskId && (
          <ResizeHandle
            ariaLabel="Redimensionar o painel de trabalho"
            edge="left"
            pane={panelPane}
          />
        )}
        {openPanels.length > 0 && effectiveTaskId && (
          <aside
            aria-label="Painel de trabalho"
            className="workspace-rail"
            data-solo={maximizedPanel ? "true" : undefined}
            style={
              {
                width: panelPane.width,
                // Balanced by default (4 panels → 2×2), overridable below.
                "--rail-columns": maximizedPanel
                  ? 1
                  : (panelColumns ??
                    Math.min(
                      Math.max(1, Math.floor(panelPane.width / 320)),
                      Math.ceil(Math.sqrt(openPanels.length)),
                    )),
              } as CSSProperties
            }
          >
            <div className="workspace-rail__bar">
              <span>Colunas</span>
              {[1, 2, 3].map((count) => (
                <button
                  data-active={panelColumns === count || undefined}
                  key={count}
                  onClick={() =>
                    setPanelColumns((current) => {
                      const next = current === count ? null : count;
                      panelColumnsRef.current = next;
                      persistLayout(openPanels, next);
                      return next;
                    })
                  }
                  title={`${count} coluna${count > 1 ? "s" : ""}`}
                  type="button"
                >
                  {count}
                </button>
              ))}
              <button
                data-active={panelColumns === null || undefined}
                onClick={() => {
                  panelColumnsRef.current = null;
                  setPanelColumns(null);
                  persistLayout(openPanels, null);
                }}
                title="Automático"
                type="button"
              >
                auto
              </button>
            </div>
            <div className="workspace-rail__grid">
              {(maximizedPanel
                ? openPanels.filter((mode) => mode === maximizedPanel)
                : openPanels
              ).map((mode) => (
                <WorkspacePanel
                  key={mode}
                  initialUrl={previewUrl}
                  isMaximized={maximizedPanel === mode}
                  mode={mode}
                  onToggleMaximize={() =>
                    setMaximizedPanel((current) =>
                      current === mode ? null : mode,
                    )
                  }
                  onClose={() => togglePanel(mode)}
                  isDropTarget={dropTarget === mode}
                  onDragStart={() => beginPanelDrag(mode)}
                  onMoveByKeyboard={(offset) =>
                    updateOpenPanels((current) => {
                      const next = [...current];
                      const from = next.indexOf(mode);
                      const to = from + offset;
                      if (from === -1 || to < 0 || to >= next.length) {
                        return current;
                      }
                      next[from] = next[to];
                      next[to] = mode;
                      return next;
                    })
                  }
                  onOpenFile={setPanelFile}
                  openFile={panelFile}
                  taskId={effectiveTaskId}
                  workspacePath={selectedTask?.workspacePath ?? null}
                />
              ))}
            </div>
          </aside>
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
): {
  label: string;
  percent: number | null;
  breakdown: Array<{ label: string; value: string; tone: string }>;
} | null {
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
  const breakdown = [
    { label: "Entrada", value: compact(usage.inputTokens), tone: "input" },
    {
      label: "Cache lido",
      value: compact(usage.cacheReadTokens),
      tone: "cache",
    },
    { label: "Saída", value: compact(usage.outputTokens), tone: "output" },
  ];
  if (!window) {
    return {
      label: `contexto ~${compact(used)} tokens`,
      percent: null,
      breakdown,
    };
  }
  const percent = Math.min(100, Math.round((used / window) * 100));
  return {
    label: `${compact(used)}/${compact(window)} tokens`,
    percent,
    breakdown,
  };
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
