import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    "providerAuth:list": [
      { provider: "mimo", entitlement: "token_plan", configured: true },
      { provider: "minimax", entitlement: "token_plan", configured: false },
    ],
    systemDoctor: {
      database: "ok",
      runtimes: [
        {
          runtime: "codex",
          status: "ready",
          version: "responses-v1",
          detail: null,
          transportId: "codex-managed",
          transportKind: "embedded",
          entitlement: "subscription",
        },
        {
          runtime: "claude",
          status: "ready",
          version: "2.1.0",
          detail: null,
          transportId: "claude-cli",
          transportKind: "cli",
          entitlement: "subscription",
        },
      ],
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
          role: "runtime",
          integrationStatus: "needs_adapter",
          detail: "CLI encontrado; aguarda companion local de hooks JSON.",
          capabilities: ["sessions", "models", "sandbox", "plugins"],
        },
      ],
    },
  });
});

it("shows verified CLI health and exposes an honest diagnostic", async () => {
  const user = userEvent.setup();
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
    await screen.findByRole("heading", { name: "CLIs e adapters" }),
  ).toBeVisible();
  expect(await screen.findByText("/bin/codex")).toBeVisible();
  expect(
    screen.getByText((_, element) => element?.textContent === "2 de 4"),
  ).toBeVisible();
  expect(screen.getByText("1", { selector: "strong" })).toBeVisible();
  expect(screen.getAllByText("Operacional")).toHaveLength(2);
  expect(screen.getByText("Não encontrado")).toBeVisible();
  expect(screen.getByText("Adapter incompleto")).toBeVisible();
  expect(screen.getByText("Nativo do Okami")).toBeVisible();
  expect(screen.getByText("CLI opcional")).toBeVisible();
  expect(screen.getByText("codex-managed")).toBeVisible();
  expect(screen.getAllByText("Incluído na assinatura")).toHaveLength(2);
  expect(
    await screen.findByRole("heading", { name: "Credenciais de Token Plan" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Assinaturas por OAuth" }),
  ).toBeVisible();
  expect(
    screen.getAllByRole("button", { name: "Conectar assinatura" }),
  ).toHaveLength(2);
  expect(screen.getAllByText("Configurado")).toHaveLength(1);
  expect(screen.getAllByText("Não configurado")).toHaveLength(1);
  expect(screen.getAllByLabelText("Chave do Token Plan")).toHaveLength(2);

  await user.click(screen.getAllByRole("button", { name: "Ver detalhes" })[0]);
  expect(
    screen.getByRole("complementary", { name: "Diagnóstico de Codex" }),
  ).toBeVisible();
  expect(screen.getAllByText("codex-cli 1.0.0")).toHaveLength(2);
  expect(screen.getByText("app_server")).toBeVisible();
  expect(screen.getByRole("button", { name: "Atualizar CLI" })).toBeDisabled();
  expect(
    screen.getByText(/não declarou uma atualização necessária/i),
  ).toBeVisible();

  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});
