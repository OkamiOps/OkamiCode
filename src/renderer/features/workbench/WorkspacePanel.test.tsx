import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePanel } from "./WorkspacePanel";

const { fsList } = vi.hoisted(() => ({
  fsList: vi.fn(async () => ({ entries: [] })),
}));

vi.mock("../../lib/ipc/client", () => ({
  workbenchClient: {
    fsList,
  },
}));

describe("WorkspacePanel", () => {
  it("renders the selected project folder as the navigable tree root", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspacePanel
          mode="files"
          onClose={() => undefined}
          onOpenFile={() => undefined}
          openFile={null}
          taskId="task-1"
          workspacePath="/Users/marcos/Documents/Git/OKamiCode-LP"
        />
      </QueryClientProvider>,
    );

    const root = await screen.findByRole("button", {
      name: "OKamiCode-LP",
    });
    expect(root).toHaveAttribute(
      "title",
      "/Users/marcos/Documents/Git/OKamiCode-LP",
    );
  });

  it("keeps an explicit external-browser action alongside the embedded browser", () => {
    const openExternal = vi.fn();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspacePanel
          initialUrl="https://okamiops.com/design-system/"
          mode="browser"
          onClose={() => undefined}
          onOpenExternal={openExternal}
          onOpenFile={() => undefined}
          openFile={null}
          taskId="task-1"
        />
      </QueryClientProvider>,
    );

    fireEvent.click(
      within(container).getByRole("button", {
        name: "Abrir no navegador externo",
      }),
    );
    expect(openExternal).toHaveBeenCalledWith(
      "https://okamiops.com/design-system/",
    );
  });

  it("does not pass non-web URLs to the embedded browser", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkspacePanel
          initialUrl="file:///Users/marcos/.ssh/id_rsa"
          mode="browser"
          onClose={() => undefined}
          onOpenFile={() => undefined}
          openFile={null}
          taskId="task-1"
        />
      </QueryClientProvider>,
    );

    expect(container.querySelector("webview")).toBeNull();
    expect(
      within(container).getByRole("button", {
        name: "Abrir no navegador externo",
      }),
    ).toBeDisabled();
  });
});
