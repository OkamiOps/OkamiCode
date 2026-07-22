import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkbenchLane } from "./api";
import { Conversation } from "./Conversation";
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

function renderConversation(isRunning = false) {
  const store = createWorkbenchStore();
  store.setState({
    streams: {
      "run-1:assistant-0": {
        laneId: agyLane.laneId,
        at: "2026-07-22T16:56:59.000Z",
        text: "CODE_AGY_LIVE_OK",
      },
    },
  });
  return render(
    <WorkbenchStoreContext.Provider value={store}>
      <Conversation isRunning={isRunning} lane={agyLane} lanes={[agyLane]} />
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

  it("shows an animated, provider-specific working state", () => {
    renderConversation(true);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Antigravity está trabalhando",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Gemini 3.6 Flash Low",
    );
  });
});
