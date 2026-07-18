import { Chip } from "@heroui/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { Activity, PanelsTopLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useOutletContext } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { AppShellOutletContext } from "../../app/layout/AppShell";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { LaneSelector, laneDisplayName } from "./LaneSelector";
import { TaskListPane } from "./TaskListPane";
import { workbenchApi, type WorkbenchApi } from "./api";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
  useWorkbenchStore,
  type WorkbenchState,
} from "./store";

interface WorkbenchPageProps {
  api?: WorkbenchApi;
}

export function WorkbenchPage({ api = workbenchApi }: WorkbenchPageProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 5_000 },
          mutations: { retry: false },
        },
      }),
  );
  const [store] = useState(createWorkbenchStore);

  return (
    <QueryClientProvider client={queryClient}>
      <WorkbenchStoreContext.Provider value={store}>
        <WorkbenchContent api={api} />
      </WorkbenchStoreContext.Provider>
    </QueryClientProvider>
  );
}

function WorkbenchContent({ api }: { api: WorkbenchApi }) {
  const shell = useOutletContext<AppShellOutletContext>();
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const selectedLaneId = useWorkbenchStore((state) => state.selectedLaneId);
  const openedLanes = useWorkbenchStore((state) => state.openedLanes);
  const activeRunId = useWorkbenchStore((state) => state.activeRunId);
  const storeActions = useWorkbenchStore(useShallow(workbenchActions));

  const tasksQuery = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: api.listTasks,
  });
  const tasks = tasksQuery.data ?? [];
  const effectiveTaskId = selectedTaskId ?? tasks[0]?.id ?? null;
  const lanesQuery = useQuery({
    queryKey: ["workbench", "lanes", effectiveTaskId],
    queryFn: () => api.listLanes(effectiveTaskId ?? undefined),
    enabled: effectiveTaskId !== null,
  });
  const lanes = lanesQuery.data ?? [];
  const effectiveLaneId = selectedLaneId ?? lanes[0]?.laneId ?? null;
  const selectedLane = effectiveLaneId
    ? (openedLanes[effectiveLaneId] ??
      lanes.find((lane) => lane.laneId === effectiveLaneId) ??
      null)
    : null;

  const openLane = useMutation({
    mutationFn: api.openLane,
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
      storeActions.setActiveRun(run.runId);
    },
  });
  const cancelRun = useMutation({
    mutationFn: api.cancelRun,
    onSuccess: (result) => {
      if (result.cancelled) storeActions.cancelActiveRun(result.runId);
    },
  });

  useEffect(() => api.subscribe(storeActions.applyEvent), [api, storeActions]);

  const taskPane = (
    <TaskListPane
      error={queryError(tasksQuery.error)}
      isLoading={tasksQuery.isLoading}
      onCollapse={shell.collapseList}
      onSelect={storeActions.selectTask}
      selectedTaskId={effectiveTaskId}
      tasks={tasks}
    />
  );
  const laneDetails = (
    <LaneSelector
      error={queryError(lanesQuery.error ?? openLane.error)}
      isLoading={lanesQuery.isLoading}
      isOpening={openLane.isPending}
      lanes={lanes.map((lane) => openedLanes[lane.laneId] ?? lane)}
      onCollapse={shell.collapseDetails}
      onOpen={(laneId) => openLane.mutate({ laneId })}
      selectedLane={selectedLane}
    />
  );

  return (
    <>
      {shell.listTarget && createPortal(taskPane, shell.listTarget)}
      {shell.detailsTarget && createPortal(laneDetails, shell.detailsTarget)}
      {shell.detailsDrawerTarget &&
        createPortal(laneDetails, shell.detailsDrawerTarget)}
      <section
        aria-labelledby="workbench-heading"
        className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden"
      >
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[var(--ok-border)] bg-[var(--ok-surface-1)] px-4">
          <div className="min-w-0">
            <p className="pane-kicker">Execução assistida</p>
            <h1
              className="truncate text-base font-semibold tracking-[-0.02em]"
              id="workbench-heading"
            >
              Okami Workbench
            </h1>
          </div>
          {selectedLane && (
            <div className="flex min-w-0 items-center gap-2">
              <Chip
                className="border border-[var(--ok-border)] bg-[var(--ok-surface-2)] text-[var(--ok-text)]"
                size="sm"
                variant="secondary"
              >
                <PanelsTopLeft
                  aria-hidden="true"
                  className="mr-1 inline text-[var(--ok-orange)]"
                  size={11}
                />
                {laneDisplayName(selectedLane)}
              </Chip>
              <Chip
                className="border border-[var(--ok-border)] bg-[var(--ok-surface-2)] text-[var(--ok-green)]"
                size="sm"
                variant="secondary"
              >
                <Activity
                  aria-hidden="true"
                  className="mr-1 inline"
                  size={11}
                />
                {selectedLane.status}
              </Chip>
            </div>
          )}
        </header>
        <Conversation />
        <Composer
          activeRunId={activeRunId}
          error={queryError(sendTurn.error ?? cancelRun.error)}
          isCancelling={cancelRun.isPending}
          isSending={sendTurn.isPending}
          lane={selectedLane}
          onCancel={async (nextRunId) => {
            await cancelRun.mutateAsync({ runId: nextRunId });
          }}
          onSend={async (input) => {
            if (!selectedLane) return;
            await sendTurn.mutateAsync({ laneId: selectedLane.laneId, input });
          }}
        />
      </section>
    </>
  );
}

function workbenchActions(state: WorkbenchState) {
  return {
    addSentMessage: state.addSentMessage,
    applyEvent: state.applyEvent,
    cancelActiveRun: state.cancelActiveRun,
    selectLane: state.selectLane,
    selectTask: state.selectTask,
    setActiveRun: state.setActiveRun,
    upsertLane: state.upsertLane,
  };
}

function queryError(error: unknown): Error | null {
  return error instanceof Error ? error : null;
}
