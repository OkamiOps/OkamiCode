import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

const api = vi.hoisted(() => ({
  usageOverview: vi.fn(),
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
    expect(screen.getByText("Não configurada")).toBeVisible();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /Simulação API equivalente/u }),
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Entrada (US$)" }),
      "2",
    );
    await user.type(
      screen.getByRole("spinbutton", { name: "Saída (US$)" }),
      "4",
    );
    await user.click(screen.getByRole("button", { name: "Salvar referência" }));

    await waitFor(() => expect(screen.getByText(/US\$.*4/u)).toBeVisible());
    expect(screen.getByText(/não é cobrança da assinatura/iu)).toBeVisible();
  });
});
