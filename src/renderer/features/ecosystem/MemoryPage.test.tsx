import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import { installOkamiMock } from "../../test/okami-mock";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../workbench/store";
import { MemoryPage } from "./MemoryPage";

beforeEach(() => {
  installOkamiMock({
    "task:list": [],
    "eco:memoryList": [],
    "memory:list": [
      {
        id: "0b96a20f-9118-4693-af77-34da829d31a1",
        rootPath: "/vault/Marcos",
        scopePath: "/vault/Marcos",
        accessMode: "read",
        createdAt: "2026-07-22T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z",
      },
    ],
    "memory:status": {
      fts5: {
        available: true,
        documents: 42,
        lastIndexedAt: "2026-07-22T10:00:00.000Z",
      },
      obsidian: { configured: true, sources: 1 },
      gbrain: { installed: false, binaryPath: null, version: null },
    },
    "memory:search": [
      {
        id: 7,
        sourceId: "0b96a20f-9118-4693-af77-34da829d31a1",
        title: "Subscription Gateway",
        path: "/vault/Marcos/okami.md",
        excerpt: "A rota preserva a assinatura e o contexto.",
        heading: "Gateway",
        citation: "/vault/Marcos/okami.md#Gateway",
        score: 1,
      },
    ],
  });
});

it("shows honest engine status and searches the FTS5 index", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkbenchStoreContext value={createWorkbenchStore()}>
        <MemoryPage />
      </WorkbenchStoreContext>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();

  expect(await screen.findByText("42 documentos indexados")).toBeVisible();
  expect(screen.getByText("Sincronizado")).toBeVisible();
  expect(screen.getByText("Não instalado")).toBeVisible();

  await user.type(screen.getByRole("searchbox"), "gateway");
  await user.click(screen.getByRole("button", { name: "Buscar" }));

  expect(await screen.findByText("Subscription Gateway")).toBeVisible();
  expect(screen.getByText(/preserva a assinatura/iu)).toBeVisible();
});
