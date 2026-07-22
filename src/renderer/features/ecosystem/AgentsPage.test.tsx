import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it } from "vitest";
import { installOkamiMock } from "../../test/okami-mock";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../workbench/store";
import { AgentsPage } from "./AgentsPage";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  installOkamiMock({
    "task:list": [],
    "eco:agents": [
      {
        name: "security-reviewer",
        description: "Revê alterações sensíveis.",
        source: "pessoal · Claude",
        model: "sonnet",
      },
    ],
    "models:list": [
      {
        runtimeKind: "claude",
        providerLabel: "Claude",
        routeKind: "native",
        source: "subscription",
        models: [
          {
            id: "sonnet",
            label: "Sonnet",
            efforts: ["low", "high"],
            defaultEffort: "high",
          },
        ],
      },
    ],
  });
});

it("creates, edits and deletes a reusable local agent profile", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <WorkbenchStoreContext value={createWorkbenchStore()}>
          <AgentsPage />
        </WorkbenchStoreContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );

  expect(
    await screen.findByRole("heading", { name: "Descobertos no Claude" }),
  ).toBeVisible();
  expect(await screen.findByText("security-reviewer")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Criar agente" }));
  await user.type(screen.getByLabelText("Nome"), "Revisor local");
  await user.type(
    screen.getByLabelText("Função"),
    "Revê código sem executar mudanças.",
  );
  await user.click(screen.getByLabelText("Revisar Git"));
  await user.click(screen.getByRole("button", { name: "Salvar agente" }));

  expect(screen.getByText("Revisor local")).toBeVisible();
  expect(localStorage.getItem("okami.local-agent-profiles.v1")).toContain(
    "Revisar Git",
  );

  await user.click(
    screen.getByRole("button", { name: "Editar Revisor local" }),
  );
  await user.clear(screen.getByLabelText("Nome"));
  await user.type(screen.getByLabelText("Nome"), "Revisor seguro");
  await user.click(screen.getByRole("button", { name: "Salvar agente" }));
  expect(screen.getByText("Revisor seguro")).toBeVisible();

  await user.click(
    screen.getByRole("button", { name: "Editar Revisor seguro" }),
  );
  await user.click(screen.getByRole("button", { name: "Excluir" }));
  await user.click(screen.getByRole("button", { name: "Excluir" }));
  expect(screen.queryByText("Revisor seguro")).not.toBeInTheDocument();
  expect(localStorage.getItem("okami.local-agent-profiles.v1")).toBe("[]");
});
