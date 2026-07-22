import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelsPage } from "./ModelsPage";

const api = vi.hoisted(() => ({
  laneEnsure: vi.fn(),
  modelFavoriteSet: vi.fn(),
  modelFavoritesList: vi.fn(),
  modelsList: vi.fn(),
  systemDoctor: vi.fn(),
  taskList: vi.fn(),
}));

vi.mock("../../lib/ipc/client", () => ({ workbenchClient: api }));
vi.mock("../workbench/store", () => ({
  useWorkbenchStore: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModelsPage", () => {
  it("collapses providers and exposes persisted favorites as quick access", async () => {
    api.modelsList.mockResolvedValue([
      {
        models: [
          {
            id: "gpt-fast",
            label: "GPT Fast",
            description: "Resposta rápida",
            efforts: ["low", "high"],
          },
          {
            id: "gpt-deep",
            label: "GPT Deep",
            description: "Raciocínio longo",
          },
        ],
        providerLabel: "ChatGPT",
        routeKind: "bridged",
        runtimeKind: "codex",
        source: "catálogo local",
      },
      {
        models: [
          { id: "mimo-v2", label: "MiMo V2", description: "Modelo Xiaomi" },
        ],
        providerLabel: "MiMo Code",
        routeKind: "native",
        runtimeKind: "mimo",
        source: "catálogo local",
      },
    ]);
    api.modelFavoritesList.mockResolvedValue([
      { runtimeKind: "codex", modelId: "gpt-fast" },
    ]);
    api.taskList.mockResolvedValue([]);
    api.systemDoctor.mockResolvedValue({
      database: "ok",
      runtimes: [],
      clients: [
        {
          client: "codex",
          integrationStatus: "ready",
          label: "Codex",
          version: "1.0",
        },
      ],
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ModelsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Acesso rápido")).toBeVisible();
    expect(
      await screen.findByRole("button", { name: /GPT Fast.*ChatGPT/i }),
    ).toBeVisible();
    expect(screen.queryByText("GPT Deep")).not.toBeInTheDocument();

    const chatGptSummary = screen
      .getAllByRole("button", { name: /ChatGPT.*Harness Claude/i })
      .find((button) => button.getAttribute("aria-expanded") === "false");
    expect(chatGptSummary).toBeDefined();
    await userEvent.click(chatGptSummary!);
    expect(screen.getByText("GPT Deep")).toBeVisible();
    expect(screen.getByText("2 níveis de effort")).toBeVisible();
  });
});
