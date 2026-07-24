import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installOkamiMock } from "../../test/okami-mock";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../workbench/store";
import { SettingsPage } from "./SettingsPage";

vi.mock("./ProviderAuthTerminal", () => ({
  ProviderAuthTerminal: () => <div data-testid="provider-auth-terminal" />,
}));

afterEach(cleanup);

beforeEach(() => {
  installOkamiMock({
    "task:list": [],
    "eco:settings": [],
    "providerAuth:list": [
      { provider: "mimo", entitlement: "token_plan", configured: true },
      { provider: "minimax", entitlement: "token_plan", configured: false },
    ],
    "providerAuth:status": [
      {
        provider: "claude",
        status: "not_connected",
        accountLabel: null,
        detail: "Conta não conectada.",
        ownership: "host",
      },
      {
        provider: "codex",
        status: "connected",
        accountLabel: "marcos@example.com",
        detail: "Conta conectada.",
        ownership: "okami",
      },
      {
        provider: "agy",
        status: "connected",
        accountLabel: "marcos@example.com",
        detail: "Conta conectada.",
        ownership: "okami",
      },
      {
        provider: "mimo",
        status: "connected",
        accountLabel: null,
        detail: "Token Plan configurado.",
        ownership: "okami",
      },
      {
        provider: "minimax",
        status: "not_connected",
        accountLabel: null,
        detail: "Token Plan não configurado.",
        ownership: "okami",
      },
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

it("puts provider connection ahead of runtime diagnostics", async () => {
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
    await screen.findByRole("heading", { name: "Conecte seus agentes" }),
  ).toBeVisible();
  expect(
    screen.getByText(/nenhum runtime usa cobrança pay-as-you-go/i),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /MiMo/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /MiniMax/i })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /OpenAI Codex/i }));
  expect(screen.getByText("Motor incluído no OkamiCode")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Reconectar assinatura" }),
  ).toBeVisible();
  expect(screen.queryByText("CLI opcional")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Conversa atual" })).toBeNull();

  await user.click(screen.getByRole("button", { name: /Antigravity/i }));
  expect(
    screen.getByRole("button", { name: "Reconectar conta" }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: /MiMo/i }));
  expect(
    screen.getByRole("heading", { name: "MiMo Token Plan" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Endpoint do Token Plan")).toHaveValue(
    "https://token-plan-ams.xiaomimimo.com/v1",
  );
  expect(screen.getByLabelText("Chave do Token Plan")).toBeVisible();

  expect(
    screen.getByRole("button", { name: /Abrir diagnóstico técnico/ }),
  ).toHaveAttribute("aria-expanded", "false");
  await user.click(
    screen.getByRole("button", { name: /Abrir diagnóstico técnico/ }),
  );
  expect(
    await screen.findByRole("heading", { name: "Diagnóstico dos runtimes" }),
  ).toBeVisible();
  expect(await screen.findByText("/bin/codex")).toBeVisible();
  await user.click(screen.getAllByRole("button", { name: "Ver detalhes" })[0]);
  expect(
    screen.getByRole("complementary", { name: "Diagnóstico de Codex" }),
  ).toBeVisible();
  expect(screen.getByText("codex-cli 1.0.0")).toBeVisible();
  expect(screen.getByText("app_server")).toBeVisible();
  expect(screen.getByText("Artefato gerenciado pelo OkamiCode")).toBeVisible();

  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});
