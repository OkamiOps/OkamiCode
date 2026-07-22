import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

const api = vi.hoisted(() => ({
  usageOverview: vi.fn(),
  usageOpenRouterPricing: vi.fn(),
  systemOpenExternal: vi.fn(),
  systemDoctor: vi.fn(),
  inboxAccountsList: vi.fn(),
  calendarSourcesList: vi.fn(),
  taskList: vi.fn(),
}));

vi.mock("../../lib/ipc/client", () => ({ workbenchClient: api }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("HomePage", () => {
  it("uses real local activity and keeps the cost estimate explicit and configurable", async () => {
    api.usageOverview.mockResolvedValue({
      generatedAt: "2026-07-21T20:00:00.000Z",
      subscriptions: [],
      alerts: [],
      context: {
        collectedAt: "2026-07-21T20:00:00.000Z",
        freshness: "live",
        laneId: null,
        remainingTokens: 900_000,
        usedPercent: 10,
        source: { adapterVersion: "1", kind: "local_estimate", method: "test" },
      },
      activity: [
        {
          bucketStart: "2026-07-21T20:00:00.000Z",
          cachedInputTokens: 0,
          durationMs: 1_000,
          inputTokens: 1_000_000,
          laneId: "lane-1",
          messages: 1,
          model: "gpt-5.6-luna",
          modelCalls: 1,
          outputTokens: 500_000,
          provider: "chatgpt",
          reasoningTokens: 0,
          runtime: "codex",
          sessions: 1,
          taskId: "task-1",
          toolCalls: 0,
        },
      ],
    });
    api.systemDoctor.mockRejectedValue(new Error("not needed"));
    api.usageOpenRouterPricing.mockResolvedValue({
      fetchedAt: "2026-07-21T20:00:00.000Z",
      sourceUrl: "https://openrouter.ai/api/v1/models",
      models: [
        {
          id: "openai/gpt-5.6-luna",
          name: "GPT-5.6 Luna",
          promptPerToken: 0.000001,
          completionPerToken: 0.000006,
          cacheReadPerToken: 0.0000001,
          reasoningPerToken: null,
          requestCost: null,
        },
      ],
    });
    api.inboxAccountsList.mockResolvedValue([]);
    api.calendarSourcesList.mockResolvedValue([]);
    api.taskList.mockResolvedValue([]);

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1,5 mi")).toBeVisible();
    expect(await screen.findAllByText(/US\$\s*4,22/u)).not.toHaveLength(0);
    expect(screen.getByText(/US\$\s*410,00\/mês/u)).toBeVisible();
    expect(screen.queryByText("openai/gpt-5.6-luna")).not.toBeInTheDocument();
    expect(screen.getByText("Entrada nova")).toBeVisible();
    expect(screen.getByText("Cache lido")).toBeVisible();
    expect(screen.getByText("Saída")).toBeVisible();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /OpenAI.*1 modelo/iu }),
    );
    expect(screen.getByText("openai/gpt-5.6-luna")).toBeVisible();
    expect(screen.getAllByText("1 mi").length).toBeGreaterThan(0);
    expect(screen.getAllByText("500 mil").length).toBeGreaterThan(0);
    await user.click(
      screen.getByRole("button", { name: /API equivalente · 30 dias/u }),
    );
    const openAi = screen.getByRole("spinbutton", {
      name: "OpenAI (US$/mês)",
    });
    await user.clear(openAi);
    await user.type(openAi, "150");
    await user.click(
      screen.getByRole("button", { name: "Salvar mensalidades" }),
    );

    await waitFor(() =>
      expect(screen.getByText(/US\$\s*360,00\/mês/u)).toBeVisible(),
    );
    expect(screen.getByText(/incluindo a taxa.*5,5%/iu)).toBeVisible();
  });

  it("shows every runtime returned by the system doctor without a fixed total", async () => {
    api.usageOverview.mockRejectedValue(new Error("usage unavailable"));
    api.usageOpenRouterPricing.mockRejectedValue(
      new Error("pricing unavailable"),
    );
    api.inboxAccountsList.mockResolvedValue([]);
    api.calendarSourcesList.mockResolvedValue([]);
    api.taskList.mockResolvedValue([]);
    api.systemDoctor.mockResolvedValue({
      database: "ok",
      runtimes: [],
      clients: [
        "Codex",
        "Claude Code",
        "Cursor",
        "Antigravity",
        "Grok",
        "MiniMax mmx",
        "MiMo Code",
      ].map((label, index) => ({
        binaryPath: `/cli/${index}`,
        capabilities: [],
        client: ["codex", "claude", "cursor", "agy", "grok", "minimax", "mimo"][
          index
        ],
        detail: "Detectado localmente",
        integrationStatus: index === 3 ? "needs_adapter" : "ready",
        label,
        role: index === 5 ? "launcher" : "runtime",
        version: "1.0.0",
      })),
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("MiMo Code")).toBeVisible();
    expect(screen.getAllByText("Antigravity").length).toBeGreaterThan(0);
    expect(screen.getByText("MiniMax mmx")).toBeVisible();
    expect(screen.getByText("6/7")).toBeVisible();
  });
});
