import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../app/layout/AppShell";
import {
  QuickChatPage,
  type QuickChatApi,
  type QuickChatMessage,
} from "./QuickChatPage";
import type { ContextChipItem } from "./ContextChips";

const chatId = "5e20d53c-6fc7-4a95-923f-c244d74aa2f0";
const taskId = "e7bbb2ef-dd6e-4039-bdd1-b2e93038e884";
const laneId = "357a948a-8c3c-4b06-b51e-228de7a34c6f";
const runId = "167b7658-6b9a-476f-bfad-87a54d9161d2";

const emailChip: ContextChipItem = {
  label: "email atual",
  ref: "email:current",
};
const memoryChip: ContextChipItem = {
  label: "nota de memória",
  ref: "memory:note-7",
};

afterEach(cleanup);

function renderQuickChat({
  chips,
  messages = [],
}: {
  chips: ContextChipItem[];
  messages?: QuickChatMessage[];
}) {
  const calls = {
    quickChatCreate: [] as Array<{ runtime: "claude" | "codex" }>,
    quickChatSend: [] as Array<{
      chatId: string;
      input: string;
      contextRefs: string[];
    }>,
    quickChatPromote: [] as Array<{
      chatId: string;
      title: string;
      objective: string;
      selectedMessageIds: string[];
      contextRefs: string[];
    }>,
  };
  const api: QuickChatApi = {
    create: vi.fn(async (request) => {
      calls.quickChatCreate.push(request);
      return {
        id: chatId,
        taskId,
        laneId,
        runtime: request.runtime,
        workspaceId: null,
        createdAt: "2026-07-18T12:00:00.000Z",
      };
    }),
    send: vi.fn(async (request) => {
      calls.quickChatSend.push(request);
      return {
        runId,
        laneId,
        messageId: "5bdd0f16-a2f3-4e6f-96c3-bf0dd6331299",
        status: "running" as const,
      };
    }),
    promote: vi.fn(async (request) => {
      calls.quickChatPromote.push(request);
      return {
        task: {
          id: taskId,
          kind: "workbench" as const,
          title: request.title,
          objective: request.objective,
          status: "active",
          workspacePath: null,
          createdAt: "2026-07-18T12:00:00.000Z",
          updatedAt: "2026-07-18T12:00:00.000Z",
        },
        conversationId: "f02a7263-12ff-4ac4-9a47-a0a2cc885ad5",
        sourceConversationId: request.chatId,
        copiedMessageIds: request.selectedMessageIds,
        contextRefs: request.contextRefs,
      };
    }),
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/quick-chat"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="/quick-chat"
              element={
                <QuickChatPage
                  api={api}
                  initialChips={chips}
                  initialMessages={messages}
                />
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { calls };
}

describe("QuickChatPage", () => {
  it("removes a context chip before sending", async () => {
    const runtime = renderQuickChat({ chips: [emailChip, memoryChip] });
    const user = userEvent.setup();

    await screen.findByText("Sem workspace");
    await user.click(
      screen.getByRole("button", { name: "Remover email atual" }),
    );
    await user.type(screen.getByRole("textbox"), "Resuma");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() =>
      expect(runtime.calls.quickChatSend[0]?.contextRefs).toEqual([
        memoryChip.ref,
      ]),
    );
  });

  it("promotes only messages and context selected by the user", async () => {
    const messages: QuickChatMessage[] = [
      { id: "message-1", role: "user", body: "Primeira mensagem" },
      { id: "message-2", role: "assistant", body: "Segunda mensagem" },
    ];
    const runtime = renderQuickChat({
      chips: [emailChip, memoryChip],
      messages,
    });
    const user = userEvent.setup();

    await screen.findByText("Sem workspace");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Incluir na promoção: Segunda mensagem",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remover email atual" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Promover para tarefa" }),
    );

    await waitFor(() =>
      expect(runtime.calls.quickChatPromote[0]).toMatchObject({
        chatId,
        selectedMessageIds: ["message-1"],
        contextRefs: [memoryChip.ref],
      }),
    );
  });
});
