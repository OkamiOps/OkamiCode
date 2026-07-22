import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { installOkamiMock } from "../../test/okami-mock";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../workbench/store";
import { ConnectionsPage } from "./ConnectionsPage";

afterEach(cleanup);

beforeEach(() => {
  installOkamiMock({
    "task:list": [],
    "eco:mcp": [
      {
        name: "linear-server",
        scope: "pessoal",
        transport: "http",
        detail: "https://mcp.linear.app/mcp",
        runtime: "claude",
      },
      {
        name: "node-repl",
        scope: "pessoal",
        transport: "stdio",
        detail: "",
        runtime: "codex",
      },
    ],
    "eco:skills": [
      {
        name: "Frontend Design",
        description: "Cria interfaces visuais.",
        source: "pessoal · compartilhada",
        category: "Design",
        invocation: "frontend-design",
        runtimes: ["claude", "codex"],
      },
      {
        name: "Code Review",
        description: "Revê alterações.",
        source: "plugin · Codex",
        category: "Engineering",
        invocation: "code-review",
        runtimes: ["codex"],
      },
    ],
  });
});

it("groups local connections without inventing update availability", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkbenchStoreContext value={createWorkbenchStore()}>
        <ConnectionsPage />
      </WorkbenchStoreContext>
    </QueryClientProvider>,
  );

  const mcpPanel = await screen.findByRole("tabpanel");
  expect(await within(mcpPanel).findByText("linear-server")).toBeVisible();
  expect(within(mcpPanel).getByText("Configurado")).toBeVisible();
  expect(within(mcpPanel).getByText("Revisar")).toBeVisible();

  await user.click(screen.getByRole("tab", { name: /Habilidades/ }));
  expect(
    screen.getByText("Atualizações não são verificáveis nesta fonte"),
  ).toBeVisible();
  expect(screen.getByText("Design")).toBeVisible();
  expect(screen.getByText("Engineering")).toBeVisible();

  await user.selectOptions(screen.getByLabelText("Filtrar origem"), "Plugins");
  expect(screen.getByText("Code Review")).toBeVisible();
  expect(screen.queryByText("Frontend Design")).not.toBeInTheDocument();
});
