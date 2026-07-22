import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { AppShell } from "../../app/layout/AppShell";
import type { WorkbenchApi } from "./api";
import { reduceCanonicalEvent, type WorkbenchState } from "./store";
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
      const closeButtons = screen.getAllByRole("button", {
        name: "Fechar painel",
      });
      expect(closeButtons).toHaveLength(remaining);
      fireEvent.click(closeButtons[0]);
    }

    expect(
      screen.queryByRole("complementary", { name: "Painel de trabalho" }),
    ).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("okami.panelLayout") ?? "null"),
    ).toEqual({ panels: [], columns: 2 });

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
