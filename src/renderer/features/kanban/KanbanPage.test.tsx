import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { KanbanCardContract } from "../../../shared/contracts/ipc";
import { KanbanPage } from "./KanbanPage";

afterEach(() => cleanup());

const card: KanbanCardContract = {
  id: "b672d2e8-688b-48ac-a618-3294bfc96a99",
  taskId: null,
  title: "Revisar proposta",
  description: "Confirmar escopo e prazo antes do envio.",
  status: "backlog",
  ownerKind: "lane",
  laneId: "50df72f3-cc11-42d2-87be-c928a9ae2cbf",
  activationPolicy: "status_transition",
  position: 0,
  stateHash: "current-state",
  lastProcessedHash: "current-state",
  lastProcessedCursor: 1,
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
};

function fixture() {
  const mutation = {
    card,
    wake: {
      shouldWake: false,
      reason: "manual_policy",
      delta: {
        stateChanged: false,
        statusChanged: false,
        ownerChanged: false,
        laneChanged: false,
      },
    },
  };
  return {
    list: vi.fn(async () => [card]),
    listLanes: vi.fn(async () => [
      {
        laneId: card.laneId!,
        taskId: "4b375b17-d774-4101-9982-00c8992c1802",
        harness: "claude" as const,
        runtimeKind: "codex" as const,
        runtimeVersion: "test",
        providerAccountLabel: "ChatGPT",
        model: "GPT-5.6 Codex",
        routeKind: "bridged" as const,
        routeReason: "account_routed" as const,
        displayQuotaAccount: "ChatGPT",
        permissionMode: null,
        temperature: "clean" as const,
        workspacePath: "/tmp/workspace",
        nativeSessionId: null,
        nativeSessionIdPrefix: null,
        delta: { events: [], fromCursorExclusive: 0, toCursorInclusive: 0 },
        status: "ready" as const,
        pendingDeltaEvents: 0,
      },
    ]),
    create: vi.fn(async () => mutation),
    move: vi.fn(async () => ({
      card: { ...card, status: "in_progress" as const },
      wake: {
        shouldWake: true,
        reason: "status_transition",
        delta: {
          stateChanged: true,
          statusChanged: true,
          ownerChanged: false,
          laneChanged: false,
        },
      },
    })),
    assign: vi.fn(async () => mutation),
    update: vi.fn(async () => mutation),
    delete: vi.fn(async () => ({ cardId: card.id, deleted: true as const })),
  };
}

function renderPage(api = fixture()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <KanbanPage api={api} />
    </QueryClientProvider>,
  );
  return api;
}

it("renders the board with explicit ownership and activation policy", async () => {
  renderPage();

  expect(await screen.findByText("Revisar proposta")).toBeInTheDocument();
  expect(screen.getByText("GPT-5.6 Codex")).toBeInTheDocument();
  expect(screen.getByText("Acorda ao mover")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Revisão" })).toBeInTheDocument();
});

it("creates manual cards by default and moves delegated cards explicitly", async () => {
  const api = renderPage();
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Nova tarefa" }));
  await user.type(
    screen.getByRole("textbox", { name: "Título da tarefa" }),
    "Preparar briefing",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Diretriz da tarefa" }),
    "Consolidar contexto e próximos passos.",
  );
  await user.click(screen.getByRole("button", { name: "Criar tarefa" }));
  expect(api.create).toHaveBeenCalledWith(
    {
      title: "Preparar briefing",
      description: "Consolidar contexto e próximos passos.",
      status: "backlog",
      ownerKind: "human",
      laneId: null,
      activationPolicy: "manual",
    },
    expect.anything(),
  );

  await user.click(
    screen.getByRole("button", {
      name: "Mover Revisar proposta para Em andamento",
    }),
  );
  expect(api.move).toHaveBeenCalledWith(
    expect.objectContaining({
      cardId: card.id,
      status: "in_progress",
      position: 0,
    }),
    expect.anything(),
  );
  expect(await screen.findByText(/Agente acordado/)).toBeInTheDocument();
});

it("edits and deletes a card from the task inspector", async () => {
  const api = renderPage();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", {
      name: "Abrir ações de Revisar proposta",
    }),
  );
  const directive = screen.getByRole("textbox", {
    name: "Editar diretriz da tarefa",
  });
  await user.clear(directive);
  await user.type(directive, "Revisar riscos e preparar recomendação.");
  await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
  expect(api.update).toHaveBeenCalledWith(
    expect.objectContaining({
      cardId: card.id,
      description: "Revisar riscos e preparar recomendação.",
    }),
    expect.anything(),
  );

  await user.click(screen.getByRole("button", { name: "Excluir" }));
  expect(screen.getByRole("dialog", { name: "Excluir tarefa" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Excluir tarefa" }));
  expect(api.delete).toHaveBeenCalledWith(
    { cardId: card.id, confirmation: "delete_kanban_card" },
    expect.anything(),
  );
});
