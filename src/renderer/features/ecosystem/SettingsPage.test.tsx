import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it } from "vitest";
import { installOkamiMock } from "../../test/okami-mock";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../workbench/store";
import { SettingsPage } from "./SettingsPage";

afterEach(cleanup);

beforeEach(() => {
  installOkamiMock({
    "task:list": [],
    "eco:settings": [],
    systemDoctor: {
      database: "ok",
      runtimes: [],
      clients: [
        {
          client: "codex",
          label: "Codex",
          binaryPath: "/bin/codex",
          version: "codex-cli 1.0.0",
          role: "runtime",
          integrationStatus: "ready",
          detail: "CLI encontrado e integrado ao runtime do Workbench.",
          capabilities: [
            "sessions",
            "models",
            "effort",
            "approvals",
            "sandbox",
            "mcp",
            "hooks",
            "subagents",
            "background",
            "git",
            "worktrees",
            "usage",
            "automations",
            "structured_output",
            "app_server",
          ],
        },
        {
          client: "claude",
          label: "Claude Code",
          binaryPath: null,
          version: null,
          role: "runtime",
          integrationStatus: "unavailable",
          detail: "CLI não encontrado neste computador.",
          capabilities: [],
        },
        {
          client: "cursor",
          label: "Cursor",
          binaryPath: "/Users/marcos/.local/bin/cursor-agent",
          version: "2026.07.17-3e2a980",
          role: "runtime",
          integrationStatus: "ready",
          detail:
            "CLI cursor-agent encontrado e protocolo stream-json compatível com o runtime.",
          capabilities: [
            "sessions",
            "models",
            "sandbox",
            "mcp",
            "git",
            "worktrees",
            "structured_output",
            "plugins",
          ],
        },
        {
          client: "agy",
          label: "AGY",
          binaryPath: "/bin/agy",
          version: "AGY 1.0.0",
          role: "launcher",
          integrationStatus: "needs_adapter",
          detail: "CLI encontrado; aguarda companion local de hooks JSON.",
          capabilities: ["sessions", "models", "sandbox", "plugins"],
        },
      ],
    },
  });
});

it("shows all client states without offering a false runtime selector", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkbenchStoreContext value={createWorkbenchStore()}>
        <SettingsPage />
      </WorkbenchStoreContext>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Clientes e capacidades" }),
  ).toBeVisible();
  expect((await screen.findAllByText("CLI encontrado")).length).toBe(3);
  expect(screen.getByText("CLI ausente")).toBeVisible();
  expect(screen.getAllByText("Integração pronta")).toHaveLength(2);
  expect(screen.getByText("Integração pendente")).toBeVisible();
  expect(screen.getAllByText("mcp")).toHaveLength(2);
  expect(screen.getAllByText("plugins")).toHaveLength(2);
  expect(screen.getByText(/instalado.*integrado/i)).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});
