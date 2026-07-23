import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { AppShell } from "../../app/layout/AppShell";
import type { WorkbenchApi } from "./api";
import {
  createWorkbenchStore,
  reduceCanonicalEvent,
  type WorkbenchState,
} from "./store";
import { WorkbenchPage } from "./WorkbenchPage";

vi.mock("./TerminalPane", () => ({
  TerminalPane: () => <div data-testid="terminal-pane" />,
}));

const taskId = "27ee79a7-d3c3-48dd-84c6-cb589a4cb606";
const claudeLaneId = "50df72f3-cc11-42d2-87be-c928a9ae2cbf";
const codexLaneId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
const runId = "4d32d86d-3199-4327-9d0c-e283268ed239";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const task: IpcResponse<"task:list">[number] = {
  id: taskId,
  kind: "workbench",
  title: "Implementar Workbench",
  objective: "Entregar conversa e lanes",
  status: "active",
  workspacePath: "/workspace/okami",
  createdAt: "2026-07-18T12:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};

const claudeLane: IpcResponse<"lane:list">[number] = {
  laneId: claudeLaneId,
  taskId,
  harness: "claude",
  runtimeKind: "claude",
  runtimeVersion: "2.1.212",
  providerAccountLabel: "Claude Max",
  model: "claude-sonnet-4-6",
  routeKind: "direct",
  routeReason: "claude_model",
  displayQuotaAccount: "Claude Max",
  permissionMode: "manual",
  workspacePath: "/workspace/okami",
  nativeSessionIdPrefix: "session-…",
  status: "ready",
  temperature: "hot",
  pendingDeltaEvents: 0,
};

const codexLane: IpcResponse<"lane:list">[number] = {
  laneId: codexLaneId,
  taskId,
  harness: "claude",
  runtimeKind: "claude",
  runtimeVersion: "0.144.5",
  providerAccountLabel: "ChatGPT",
  model: "gpt-5.6",
  routeKind: "bridged",
  routeReason: "subscription_bridge",
  displayQuotaAccount: "ChatGPT Plus",
  permissionMode: null,
  workspacePath: "/workspace/okami",
  nativeSessionIdPrefix: "thread-1…",
  status: "ready",
  temperature: "stale",
  pendingDeltaEvents: 3,
};

const cursorLane: IpcResponse<"lane:list">[number] = {
  ...codexLane,
  laneId: "a1c937ea-b035-437b-807f-a0fad86ca036",
  harness: "native",
  runtimeKind: "cursor",
  runtimeVersion: "2026.07.17-3e2a980",
  providerAccountLabel: "Cursor",
  model: "default",
  routeKind: "native",
  routeReason: "native_requested",
  displayQuotaAccount: "Cursor subscription",
  permissionMode: "manual",
};

function renderWorkbenchFixture({
  lanes,
  history = { userMessages: [], events: [] },
}: {
  lanes: IpcResponse<"lane:list">;
  history?: IpcResponse<"conversation:history">;
}) {
  let eventListener: ((event: CanonicalEvent) => void) | undefined;
  const calls = {
    laneOpen: [] as Array<{ laneId: string; inheritTask?: boolean }>,
    laneEnsure: [] as IpcRequest<"lane:ensure">[],
    laneClose: [] as Array<{ laneId: string }>,
    laneSendTurn: [] as Array<{ laneId: string; input: string }>,
    runCancel: [] as Array<{ runId: string }>,
  };
  const api: WorkbenchApi = {
    listTasks: vi.fn(async () => [task]),
    pickWorkspace: vi.fn(async () => ({ path: "/workspace/okami" })),
    pickFiles: vi.fn(async () => ({ paths: [] })),
    renameTask: vi.fn(async () => task),
    deleteTask: vi.fn(async () => ({ taskId: task.id, deleted: true })),
    createTask: vi.fn(async () => task),
    history: vi.fn(async () => history),
    listModels: vi.fn(async () => [
      {
        runtimeKind: "claude" as const,
        providerLabel: "Claude Max",
        routeKind: "direct" as const,
        source: "aliases do Claude Code (/model)",
        models: [
          { id: "opus", label: "Opus" },
          { id: "sonnet", label: "Sonnet" },
          { id: "haiku", label: "Haiku" },
        ],
      },
      {
        runtimeKind: "codex" as const,
        providerLabel: "ChatGPT",
        routeKind: "bridged" as const,
        source: "catálogo do Codex CLI (models_cache.json)",
        models: [
          { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
          { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
          { id: "gpt-5.5", label: "GPT-5.5" },
        ],
      },
    ]),
    listModelFavorites: vi.fn(async () => []),
    listSkills: vi.fn(async () => [
      {
        name: "frontend-design",
        invocation: "frontend-design",
        description: "Crie interfaces premium com acabamento visual.",
        category: "Design",
        source: "pessoal · compartilhada",
        runtimes: ["claude", "codex"] as Array<"claude" | "codex">,
      },
      {
        name: "systematic-debugging",
        invocation: "systematic-debugging",
        description: "Diagnóstico disciplinado de bugs.",
        category: "Code review",
        source: "plugin · Codex · Superpowers",
        runtimes: ["codex"] as Array<"claude" | "codex">,
      },
    ]),
    ensureLane: vi.fn(async (request: IpcRequest<"lane:ensure">) => {
      calls.laneEnsure.push(request);
      return { ...codexLane, model: request.model };
    }),
    listLanes: vi.fn(async () => lanes),
    openLane: vi.fn(async (request) => {
      calls.laneOpen.push(request);
      const lane = lanes.find(
        (candidate) => candidate.laneId === request.laneId,
      );
      if (!lane) throw new Error("Lane ausente no fixture");
      return lane;
    }),
    sendTurn: vi.fn(async (request) => {
      calls.laneSendTurn.push(request);
      return { runId, laneId: request.laneId, status: "running" as const };
    }),
    cancelRun: vi.fn(async (request) => {
      calls.runCancel.push(request);
      return { runId: request.runId, cancelled: true };
    }),
    subscribe: (listener) => {
      eventListener = listener;
      return () => {
        if (eventListener === listener) eventListener = undefined;
      };
    },
  };

  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/workbench"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/workbench" element={<WorkbenchPage api={api} />} />
            <Route
              path="/settings"
              element={<Link to="/workbench">Voltar à conversa</Link>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return {
    ...view,
    calls,
    emit(event: CanonicalEvent) {
      act(() => eventListener?.(event));
    },
  };
}

function messageDelta(delta: string): CanonicalEvent {
  return {
    schemaVersion: 1,
    id: `event-${delta}`,
    taskId,
    laneId: claudeLaneId,
    runId,
    sequence: delta === "Olá " ? 1 : 2,
    occurredAt: "2026-07-18T12:00:00.000Z",
    kind: "message_delta",
    nativeEventId: "msg-1",
    payload: { delta },
  };
}

describe("WorkbenchPage", () => {
  it("keeps provider and model in the conversation instead of duplicating them in the topbar", async () => {
    const { container } = renderWorkbenchFixture({
      lanes: [claudeLane],
      history: {
        userMessages: [
          {
            id: "message-runtime",
            laneId: claudeLaneId,
            body: "Mostre a identidade da resposta",
            at: "2026-07-18T12:00:00.000Z",
          },
        ],
        events: [],
      },
    });

    await screen.findByText("Mostre a identidade da resposta");
    expect(container.querySelector(".chat-topbar__runtime")).toBeNull();
    expect(container.querySelector(".chat-topbar__token-report")).toBeNull();
  });

  it("keeps workspace tools available while showing one focused inspector", async () => {
    localStorage.setItem(
      "okami.panelLayout",
      JSON.stringify({
        panels: ["changes", "files", "terminal", "browser", "tasks"],
        active: "changes",
      }),
    );

    renderWorkbenchFixture({
      lanes: [claudeLane],
      history: {
        userMessages: [
          {
            id: "message-inspector",
            laneId: claudeLaneId,
            body: "Inspecionar worktree",
            at: "2026-07-18T12:00:00.000Z",
          },
        ],
        events: [],
      },
    });

    expect(
      await screen.findByRole("region", { name: "Alterações" }),
    ).toBeVisible();
    expect(screen.queryByTestId("terminal-pane")).toBeNull();

    fireEvent.click(screen.getByTitle("Terminal"));
    expect(await screen.findByTestId("terminal-pane")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Alterações" })).toBeNull();

    expect(
      JSON.parse(localStorage.getItem("okami.panelLayout") ?? "null"),
    ).toMatchObject({
      panels: ["changes", "files", "terminal", "browser", "tasks"],
      active: "terminal",
    });
  });

  it("closes an active workspace panel when its toolbar action is clicked again", async () => {
    renderWorkbenchFixture({
      lanes: [claudeLane],
      history: {
        userMessages: [
          {
            id: "message-toggle",
            laneId: claudeLaneId,
            body: "Alternar painel",
            at: "2026-07-18T12:00:00.000Z",
          },
        ],
        events: [],
      },
    });

    const changes = await screen.findByTitle("Alterações");
    fireEvent.click(changes);
    expect(
      await screen.findByRole("region", { name: "Alterações" }),
    ).toBeVisible();

    fireEvent.click(changes);
    expect(
      screen.queryByRole("complementary", { name: "Painel de trabalho" }),
    ).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("okami.panelLayout") ?? "null"),
    ).toEqual({ panels: [], active: null });
  });

  it("keeps every workspace panel closed after navigating away and back", async () => {
    localStorage.setItem(
      "okami.panelLayout",
      JSON.stringify({
        panels: ["files", "terminal", "browser", "tasks"],
        columns: 2,
      }),
    );
    const history: IpcResponse<"conversation:history"> = {
      userMessages: [
        {
          id: "message-1",
          laneId: claudeLaneId,
          body: "Conversa persistida",
          at: "2026-07-18T12:00:00.000Z",
        },
      ],
      events: [],
    };

    renderWorkbenchFixture({ lanes: [claudeLane], history });
    await screen.findByRole("complementary", { name: "Painel de trabalho" });

    for (let remaining = 4; remaining > 0; remaining -= 1) {
      const closeButton = screen.getByRole("button", {
        name: "Fechar painel",
      });
      const rail = screen.getByRole("complementary", {
        name: "Painel de trabalho",
      });
      expect(
        within(rail).getAllByRole("button", {
          name: /^(Arquivos|Terminal|Navegador|Tarefas em segundo plano)$/,
        }),
      ).toHaveLength(remaining);
      fireEvent.click(closeButton);
    }

    expect(
      screen.queryByRole("complementary", { name: "Painel de trabalho" }),
    ).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("okami.panelLayout") ?? "null"),
    ).toEqual({ panels: [], active: null });

    await userEvent.click(screen.getByRole("link", { name: "Configurações" }));
    await userEvent.click(
      screen.getByRole("link", { name: "Voltar à conversa" }),
    );
    await screen.findByText("Conversa persistida");

    expect(
      screen.queryByRole("complementary", { name: "Painel de trabalho" }),
    ).toBeNull();
  });

  it("merges deltas once and preserves both lanes when the user switches", async () => {
    const runtime = renderWorkbenchFixture({
      lanes: [claudeLane, codexLane],
    });
    await screen.findByRole("button", { name: "Selecionar modelo" });

    runtime.emit(messageDelta("Olá "));
    runtime.emit(messageDelta("mundo"));
    runtime.emit(messageDelta("mundo"));

    expect(await screen.findByText("Olá mundo")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Selecionar modelo" }),
    );
    // Two-pane picker: choose the provider column first, then the model.
    await userEvent.click(screen.getByRole("tab", { name: /ChatGPT/i }));
    await userEvent.click(
      screen.getByRole("option", { name: /GPT-5\.6-sol/i }),
    );
    expect(runtime.calls.laneEnsure.at(-1)).toMatchObject({
      taskId,
      runtimeKind: "codex",
      model: "gpt-5.6-sol",
    });
    expect(runtime.calls.laneClose).toHaveLength(0);
  });

  it("shows the effective route before send and cancels the active run", async () => {
    const runtime = renderWorkbenchFixture({ lanes: [codexLane] });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Selecionar modelo" }),
    );
    expect(screen.getAllByText(/ChatGPT/u).length).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Não informado")).toBeNull();

    await user.type(
      screen.getByRole("textbox", { name: "Mensagem" }),
      "Continue a implementação{Enter}",
    );
    await waitFor(() =>
      expect(runtime.calls.laneSendTurn).toEqual([
        { laneId: codexLaneId, input: "Continue a implementação" },
      ]),
    );

    await user.click(screen.getByRole("button", { name: "Interromper" }));
    expect(runtime.calls.runCancel).toEqual([{ runId }]);
  });

  it("turns /goal into a persistent objective strip and exposes the full add menu", async () => {
    const runtime = renderWorkbenchFixture({ lanes: [codexLane] });

    await screen.findByTitle("Modo de permissão da lane");
    const sendButton = await screen.findByRole("button", { name: "Enviar" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Adicionar ao contexto" }),
    );
    expect(
      screen.getByRole("button", { name: "Adicionar arquivos ou fotos" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Tarefas em segundo plano" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Definir objetivo" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Definir objetivo" }));
    const composer = screen.getByRole("textbox", { name: "Mensagem" });
    await waitFor(() => expect(composer).toHaveValue("/goal "));
    fireEvent.change(composer, {
      target: { value: "/goal entregar o painel premium" },
    });
    expect(composer).toHaveValue("/goal entregar o painel premium");
    await waitFor(() => expect(sendButton).toBeEnabled());
    fireEvent.click(sendButton);

    await waitFor(() =>
      expect(runtime.calls.laneSendTurn.at(-1)?.input).toBe(
        "/goal entregar o painel premium",
      ),
    );
    expect(await screen.findByText("Objetivo em andamento")).toBeVisible();
    expect(screen.getByText("entregar o painel premium")).toBeVisible();
    expect(localStorage.getItem(`okami.goal.${taskId}`)).toContain(
      "entregar o painel premium",
    );
  });

  it("discovers compatible skills in the slash palette and inserts the native invocation", async () => {
    renderWorkbenchFixture({ lanes: [claudeLane] });
    await screen.findByTitle("Modo de permissão da lane");
    const composer = await screen.findByRole("textbox", { name: "Mensagem" });

    fireEvent.change(composer, { target: { value: "/" } });

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Comandos e skills" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("navigation", { name: "Categorias de skills" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Design1/u })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /\/frontend-design/u }));
    expect(composer).toHaveValue("/frontend-design ");
  });

  it("keeps the skill catalog visible and honest on runtimes without native skill support", async () => {
    renderWorkbenchFixture({ lanes: [cursorLane] });
    await screen.findByTitle("Modo de permissão da lane");
    const composer = screen.getByRole("textbox", { name: "Mensagem" });

    fireEvent.change(composer, { target: { value: "/frontend" } });

    const skill = await screen.findByRole("button", {
      name: /\/frontend-design/u,
    });
    expect(skill).toBeDisabled();
    expect(skill).toHaveAttribute("title", "Disponível em Claude e Codex");
  });

  it("hides permission modes the Cursor runtime cannot execute safely", async () => {
    renderWorkbenchFixture({ lanes: [cursorLane] });
    const menu = await screen.findByTitle("Modo de permissão da lane");

    await userEvent.click(menu);

    expect(screen.getAllByRole("button", { name: /^Manual/u })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /^Planejar/u })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Automático/u })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /^Aceitar edições/u }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Ignorar permissões/u }),
    ).toBeNull();
  });
});

it("marks completed and failed runs without mutating duplicate events", () => {
  const base = {
    appliedEventIds: {},
    streams: {},
    runStatus: {},
  } as WorkbenchState;
  const completed: CanonicalEvent = {
    ...messageDelta("fim"),
    id: "completed-event",
    kind: "run_completed",
    payload: {},
  };
  const next = reduceCanonicalEvent(base, completed);

  expect(next.runStatus[runId]).toBe("completed");
  expect(reduceCanonicalEvent(next, completed)).toBe(next);
});

it("tracks concurrent lane activity and persists unseen completions", () => {
  const store = createWorkbenchStore();
  const secondRunId = "d7059114-39f2-4a24-894f-b487f26a653e";
  const secondLaneId = "89833940-7683-4b55-b490-a20eb6094681";

  store.getState().setActiveRun(runId, claudeLaneId);
  store.getState().setActiveRun(secondRunId, secondLaneId);

  expect(store.getState().runningRuns).toEqual({
    [runId]: claudeLaneId,
    [secondRunId]: secondLaneId,
  });

  store.getState().applyEvent({
    ...messageDelta(""),
    id: "background-completed",
    kind: "run_completed",
    payload: {},
  });

  expect(store.getState().runningRuns).toEqual({
    [secondRunId]: secondLaneId,
  });
  expect(store.getState().unreadByLane).toEqual({ [claudeLaneId]: 1 });
  expect(
    JSON.parse(localStorage.getItem("okami.code.project-activity") ?? "null"),
  ).toMatchObject({ unreadByLane: { [claudeLaneId]: 1 } });
});

it("projects completion-only provider responses into the Code conversation", () => {
  const base = {
    appliedEventIds: {},
    streams: {},
    runStatus: {},
  } as WorkbenchState;
  const completed: CanonicalEvent = {
    ...messageDelta(""),
    id: "agy-completed-message",
    kind: "message_completed",
    payload: { text: "CODE_AGY_OK", messageAnchor: "assistant-0" },
  };

  const next = reduceCanonicalEvent(base, completed);

  expect(next.streams[`${runId}:assistant-0`]).toMatchObject({
    text: "CODE_AGY_OK",
    laneId: claudeLaneId,
  });
});

it("does not duplicate a response that was already streamed as deltas", () => {
  const base = {
    appliedEventIds: {},
    streams: {},
    runStatus: {},
  } as WorkbenchState;
  const streamed = reduceCanonicalEvent(base, messageDelta("Já transmitida"));
  const completed: CanonicalEvent = {
    ...messageDelta(""),
    id: "streamed-completed-message",
    kind: "message_completed",
    nativeEventId: "completed-anchor",
    payload: { text: "Já transmitida" },
  };

  const next = reduceCanonicalEvent(streamed, completed);

  expect(Object.values(next.streams)).toHaveLength(1);
  expect(Object.values(next.streams)[0]?.text).toBe("Já transmitida");
});

it("keeps the latest usage report instead of a stale session peak", () => {
  const base = {
    appliedEventIds: {},
    lastUsageByLane: {},
  } as WorkbenchState;
  const first: CanonicalEvent = {
    ...messageDelta(""),
    id: "usage-high",
    kind: "usage_reported",
    payload: {
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 820_000,
        output_tokens: 42_000,
      },
      modelUsage: { "claude-fable-5": { contextWindow: 1_000_000 } },
    },
  };
  const second: CanonicalEvent = {
    ...first,
    id: "usage-latest",
    sequence: 3,
    payload: {
      usage: {
        input_tokens: 8,
        cache_read_input_tokens: 40_000,
        output_tokens: 2_000,
      },
      modelUsage: { "claude-fable-5": { contextWindow: 1_000_000 } },
    },
  };

  const high = reduceCanonicalEvent(base, first);
  const latest = reduceCanonicalEvent(high, second);

  expect(latest.lastUsageByLane[claudeLaneId]).toMatchObject({
    inputTokens: 8,
    cacheReadTokens: 40_000,
    outputTokens: 2_000,
    contextTokens: null,
  });
});
