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
          client: "cursor",
          label: "Cursor",
          binaryPath:
            "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
          version: "Cursor 1.0.0",
          role: "launcher",
          integrationStatus: "needs_adapter",
          detail: "CLI encontrado; a integração de runtime ainda não existe.",
          capabilities: ["launcher", "mcp"],
        },
      ],
    },
  });
});

it("shows client discovery separately from runtime integration with wrapped capability chips", async () => {
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
  expect(await screen.findByText("CLI encontrado")).toBeVisible();
  expect(screen.getByText("Integração pendente")).toBeVisible();
  expect(screen.getByText("launcher")).toBeVisible();
  expect(screen.getByText("mcp")).toBeVisible();
  expect(screen.getByText(/instalado.*integrado/i)).toBeVisible();
});
