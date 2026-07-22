import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageOverviewContract } from "../../../shared/contracts/ipc";
import { UsagePage } from "./UsagePage";

afterEach(cleanup);

const overview: UsageOverviewContract = {
  alerts: [
    {
      accountRef: "chatgpt-main",
      enabled: true,
      provider: "chatgpt",
      remainingPercent: 25,
    },
  ],
  activity: [
    {
      bucketStart: "2026-07-17T09:00:00.000Z",
      cachedInputTokens: 100,
      durationMs: 3_600_000,
      inputTokens: 700,
      laneId: "lane-codex",
      messages: 3,
      model: "gpt-5.6",
      modelCalls: 2,
      outputTokens: 200,
      provider: "chatgpt",
      reasoningTokens: 50,
      runtime: "codex",
      sessions: 1,
      taskId: "task-one",
      toolCalls: 1,
    },
    {
      bucketStart: "2026-07-18T21:00:00.000Z",
      cachedInputTokens: 0,
      durationMs: 7_200_000,
      inputTokens: 1200,
      laneId: "lane-claude",
      messages: 5,
      model: "claude-sonnet-4-6",
      modelCalls: 3,
      outputTokens: 400,
      provider: "claude_max",
      reasoningTokens: 0,
      runtime: "claude",
      sessions: 1,
      taskId: "task-two",
      toolCalls: 2,
    },
  ],
  context: {
    collectedAt: "2026-07-18T21:05:00.000Z",
    freshness: "estimated",
    laneId: "lane-claude",
    remainingTokens: 124000,
    source: {
      adapterVersion: "event-v1",
      kind: "local_estimate",
      method: "native_session_events",
    },
    usedPercent: 38,
  },
  generatedAt: "2026-07-18T21:05:00.000Z",
  subscriptions: [
    {
      accountLabel: "ChatGPT Plus",
      accountRef: "chatgpt-main",
      collectedAt: "2026-07-18T21:05:00.000Z",
      credits: null,
      error: null,
      freshness: "live",
      plan: "Plus",
      provider: "chatgpt",
      runtime: "codex",
      source: {
        adapterVersion: "codex-app-server-v1",
        kind: "official_structured",
        method: "account/rateLimits/read + account/usage/read",
      },
      validUntil: "2026-07-18T21:15:00.000Z",
      windows: [
        {
          durationMinutes: 300,
          kind: "rolling",
          label: "5 horas",
          modelGroup: null,
          remainingPercent: 72,
          resetsAt: "2026-07-18T22:30:00.000Z",
          usedPercent: 28,
        },
      ],
    },
    {
      accountLabel: "Claude Max",
      accountRef: "claude-main",
      collectedAt: "2026-07-18T20:00:00.000Z",
      credits: null,
      error: "Parser incompatível com Claude 2.2.0",
      freshness: "stale",
      plan: "Max",
      provider: "claude_max",
      runtime: "claude",
      source: {
        adapterVersion: "claude-usage-v2.1.214",
        kind: "native_presentational",
        method: "native /usage screen",
      },
      validUntil: "2026-07-18T20:10:00.000Z",
      windows: [],
    },
  ],
};

function renderUsageFixture() {
  render(<UsagePage overview={overview} />);
}

describe("UsagePage", () => {
  it("labels quota, session context, and local activity as separate measures", () => {
    renderUsageFixture();

    expect(
      screen.getByRole("columnheader", { name: "Quota da assinatura" }),
    ).toBeVisible();
    expect(screen.getByText("Contexto desta sessão")).toBeVisible();
    expect(screen.getByText("Atividade local")).toBeVisible();
  });

  it("shows source and freshness beside values and never fabricates unavailable quota", () => {
    renderUsageFixture();

    expect(screen.getAllByText("72% restante").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/official_structured · live/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("quota indisponível")).toBeVisible();
    expect(
      screen.getAllByText(/native_presentational · stale/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/local_estimate · estimated/i).length,
    ).toBeGreaterThan(0);
  });

  it("aggregates every CLI in Geral and filters the same stats by provider", async () => {
    renderUsageFixture();

    expect(screen.getByText("2.650")).toBeVisible();
    expect(screen.getByText("2 sessões")).toBeVisible();
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Filtrar atividade" }),
      "claude",
    );
    expect(screen.getByText("1.600")).toBeVisible();
    expect(screen.getByText("1 sessão")).toBeVisible();
    expect(screen.getAllByText("claude-sonnet-4-6").length).toBeGreaterThan(0);
  });

  it("renders the annual calendar heatmap through Recharts", () => {
    renderUsageFixture();

    expect(
      screen.getByRole("img", { name: "Heatmap de atividade local" }),
    ).toBeVisible();
  });

  it("shows all providers and labels unavailable quota honestly", async () => {
    renderUsageFixture();

    expect(screen.getAllByText("Antigravity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MiMo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MiniMax").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sem leitura").length).toBeGreaterThan(0);
    expect(screen.getAllByText("72% restante").length).toBeGreaterThan(0);

    await userEvent.click(
      screen.getByRole("button", { name: /Claude.*Sem leitura/i }),
    );
    expect(
      screen.getByRole("button", { name: /Claude.*Sem leitura/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
