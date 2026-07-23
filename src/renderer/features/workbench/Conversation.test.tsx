import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchLane } from "./api";
import { Conversation } from "./Conversation";
import { MessageMarkdown } from "./MessageMarkdown";
import type { EventCardEvent } from "./events/EventCardRegistry";
import { createWorkbenchStore, WorkbenchStoreContext } from "./store";

const agyLane = {
  laneId: "agy-lane",
  runtimeKind: "agy",
  providerAccountLabel: "Antigravity",
  model: "Gemini 3.6 Flash Low",
} as WorkbenchLane;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderConversation(
  isRunning = false,
  initialEvents: EventCardEvent[] = [],
  userMessage?: string,
  streams?: Record<string, { laneId: string; at: string; text: string }>,
) {
  const store = createWorkbenchStore();
  store.setState({
    sentMessages: userMessage
      ? [
          {
            id: "user-1",
            laneId: agyLane.laneId,
            at: "2026-07-22T16:56:58.000Z",
            body: userMessage,
          },
        ]
      : [],
    streams: streams ?? {
      "run-1:assistant-0": {
        laneId: agyLane.laneId,
        at: "2026-07-22T16:56:59.000Z",
        text: "CODE_AGY_LIVE_OK",
      },
    },
  });
  return render(
    <WorkbenchStoreContext.Provider value={store}>
      <Conversation
        initialEvents={initialEvents}
        isRunning={isRunning}
        lane={agyLane}
        lanes={[agyLane]}
      />
    </WorkbenchStoreContext.Provider>,
  );
}

describe("Conversation", () => {
  it("identifies the provider and model on every non-Claude response", () => {
    renderConversation();

    expect(screen.getByText("Antigravity")).toBeVisible();
    expect(screen.getByText("Gemini 3.6 Flash Low")).toBeVisible();
    expect(screen.getByText("CODE_AGY_LIVE_OK")).toBeVisible();
  });

  it("renders a user turn in a stable native bubble without splitting short words", () => {
    const { container } = renderConversation(false, [], "continue");

    const bubble = container.querySelector(".message-bubble--user");
    expect(bubble).toBeVisible();
    expect(bubble).toHaveTextContent("continue");
    expect(bubble?.tagName).toBe("DIV");
  });

  it("shows an animated, provider-specific working state", () => {
    renderConversation(true);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Antigravity está trabalhando",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Gemini 3.6 Flash Low",
    );
  });

  it("shows run duration and observed token usage beside the response", () => {
    renderConversation(false, [
      {
        id: "usage-1",
        kind: "usage_reported",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:20.000Z",
        payload: {
          usage: {
            input_tokens: 120,
            cache_read_input_tokens: 1_000,
            output_tokens: 80,
          },
        },
      },
      {
        id: "completed-1",
        kind: "run_completed",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:41.000Z",
        payload: {},
      },
    ]);

    expect(screen.getByText("Trabalhou por 42s")).toBeVisible();
    expect(screen.getByText("1.2k tokens")).toBeVisible();
    expect(screen.getByText("1 turno")).toBeVisible();
  });

  it("states when a runtime does not expose token accounting", () => {
    renderConversation(false, [
      {
        id: "usage-unavailable",
        kind: "usage_reported",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:20.000Z",
        payload: {
          usage: {
            available: false,
            source: "agy_cli",
          },
        },
      },
      {
        id: "completed-unavailable",
        kind: "run_completed",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:21.000Z",
        payload: {},
      },
    ]);

    expect(
      screen.getByText("tokens indisponíveis · CLI não informa"),
    ).toBeVisible();
  });

  it("states when a completed turn did not report token accounting", () => {
    renderConversation(false, [
      {
        id: "completed-without-usage",
        kind: "run_completed",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:21.000Z",
        payload: {},
      },
    ]);

    expect(screen.getByText("tokens não reportados neste turno")).toBeVisible();
  });

  it("reduces completed tool activity to one expandable run summary", () => {
    renderConversation(false, [
      {
        id: "tool-1-start",
        kind: "tool_call_started",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:01.000Z",
        payload: { toolName: "Read", toolUseId: "tool-1" },
      },
      {
        id: "approval-1",
        kind: "approval_requested",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:02.000Z",
        payload: {},
      },
      {
        id: "tool-1-complete",
        kind: "tool_call_completed",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:03.000Z",
        payload: { toolName: "Read", toolUseId: "tool-1" },
      },
      {
        id: "tool-2-start",
        kind: "tool_call_started",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:04.000Z",
        payload: { toolName: "Bash", toolUseId: "tool-2" },
      },
      {
        id: "tool-2-complete",
        kind: "tool_call_completed",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:05.000Z",
        payload: { toolName: "Bash", toolUseId: "tool-2" },
      },
      {
        id: "completed-1",
        kind: "run_completed",
        laneId: agyLane.laneId,
        runId: "run-1",
        occurredAt: "2026-07-22T16:57:09.000Z",
        payload: {},
      },
    ]);

    const summary = screen.getByRole("button", {
      name: /trabalhou por 10s.*2 ações/i,
    });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Lido um arquivo")).not.toBeInTheDocument();

    fireEvent.click(summary);
    expect(screen.getByText("Lido um arquivo")).toBeVisible();
    expect(screen.getByText("Executado um comando")).toBeVisible();
  });

  it("treats a soft newline as prose instead of forcing a visual break", () => {
    const { container } = render(
      <MessageMarkdown>
        {"Uma frase que\ncontinua normalmente."}
      </MessageMarkdown>,
    );

    expect(container.querySelector("br")).not.toBeInTheDocument();
    expect(
      screen.getByText(/uma frase que\s+continua normalmente/i),
    ).toBeVisible();
  });

  it("folds intermediate agent updates and leaves the final answer open", () => {
    renderConversation(false, [], undefined, {
      "run-1:assistant-0": {
        laneId: agyLane.laneId,
        at: "2026-07-22T16:56:59.000Z",
        text: "Vou verificar a configuração.",
      },
      "run-1:assistant-1": {
        laneId: agyLane.laneId,
        at: "2026-07-22T16:57:02.000Z",
        text: "Encontrei o deployment e estou validando os links.",
      },
      "run-1:assistant-2": {
        laneId: agyLane.laneId,
        at: "2026-07-22T16:57:07.000Z",
        text: "Tudo validado: o deployment está pronto para revisão.",
      },
    });

    expect(
      screen.getByText("Tudo validado: o deployment está pronto para revisão."),
    ).toBeVisible();
    expect(screen.queryByText("Vou verificar a configuração.")).toBeNull();
    expect(
      screen.queryByText("Encontrei o deployment e estou validando os links."),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /2 atualizações do agente/u }),
    );
    expect(screen.getByText("Vou verificar a configuração.")).toBeVisible();
    expect(
      screen.getByText("Encontrei o deployment e estou validando os links."),
    ).toBeVisible();
  });

  it("opens Markdown links inside the workspace browser and keeps an external option", () => {
    const openInside = vi.fn();
    const openExternal = vi.fn();

    render(
      <MessageMarkdown onOpenExternal={openExternal} onOpenUrl={openInside}>
        {"[Abrir a prévia](https://okamiops.com/design-system/)"}
      </MessageMarkdown>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Abrir a prévia" }));
    expect(openInside).toHaveBeenCalledWith(
      "https://okamiops.com/design-system/",
    );

    fireEvent.click(screen.getByRole("button", { name: "Opções do link" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Abrir no navegador" }),
    );
    expect(openExternal).toHaveBeenCalledWith(
      "https://okamiops.com/design-system/",
    );
  });

  it("renders safe inline HTML without allowing script execution surfaces", () => {
    const { container } = render(
      <MessageMarkdown>
        {
          "<details><summary>Prévia HTML</summary><p>Conteúdo renderizado.</p><script>window.bad = true</script></details>"
        }
      </MessageMarkdown>,
    );

    expect(screen.getByText("Prévia HTML")).toBeVisible();
    expect(screen.getByText("Conteúdo renderizado.")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
});
