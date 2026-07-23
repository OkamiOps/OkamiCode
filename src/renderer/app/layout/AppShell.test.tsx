import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { installOkamiMock } from "../../test/okami-mock";

function renderApp(path: string) {
  window.history.replaceState({}, "", `/#${path}`);
  return render(<App />);
}

describe("AppShell", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    installOkamiMock({ "task:list": [], "lane:list": [] });
  });

  it("navigates with keyboard and exposes the active destination", async () => {
    renderApp("/workbench");
    const usage = screen.getByRole("link", { name: "Uso e limites" });
    usage.focus();
    await userEvent.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Uso e limites" }),
    ).toBeVisible();
    expect(usage).toHaveAttribute("aria-current", "page");
  });

  it("separates global quick chat from the Code project history", async () => {
    renderApp("/workbench");

    const navigation = await screen.findByRole("navigation", {
      name: "Navegação principal",
    });
    expect(navigation).toBeVisible();
    expect(
      within(navigation).getByRole("img", { name: "OkamiCode" }),
    ).toBeVisible();
    expect(within(navigation).getByText("OkamiCode")).toBeVisible();
    expect(screen.getByRole("link", { name: "Code" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Histórico de projetos" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Novo projeto" })).toBeVisible();
    expect(
      screen.getByRole("searchbox", { name: "Buscar projetos" }),
    ).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Redimensionar projetos" }),
    ).toBeVisible();
  });

  it("shows a readable project status instead of an unexplained dot", async () => {
    installOkamiMock({
      "task:list": [
        {
          id: "27ee79a7-d3c3-48dd-84c6-cb589a4cb606",
          kind: "workbench",
          title: "Okami Workspace",
          objective: "Continuar o app",
          status: "active",
          workspacePath: "/workspace/okami",
          createdAt: "2026-07-22T03:00:00.000Z",
          updatedAt: new Date().toISOString(),
        },
      ],
      "lane:list": [],
    });
    renderApp("/workbench");

    expect(await screen.findByText("Ativo")).toBeVisible();
    expect(screen.getByText("agora")).toBeVisible();
  });

  it("makes project pinning and color personalization visible and persistent", async () => {
    installOkamiMock({
      "task:list": [
        {
          id: "27ee79a7-d3c3-48dd-84c6-cb589a4cb606",
          kind: "workbench",
          title: "Alpha",
          objective: "Primeiro projeto",
          status: "active",
          workspacePath: "/workspace/alpha",
          createdAt: "2026-07-22T03:00:00.000Z",
          updatedAt: "2026-07-23T09:00:00.000Z",
        },
        {
          id: "94e1d8f5-1369-4c75-89c9-3ac95f071091",
          kind: "workbench",
          title: "Beta",
          objective: "Segundo projeto",
          status: "active",
          workspacePath: "/workspace/beta",
          createdAt: "2026-07-21T03:00:00.000Z",
          updatedAt: "2026-07-22T09:00:00.000Z",
        },
      ],
      "lane:list": [],
    });
    const { container } = renderApp("/workbench");
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Opções de Beta" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Fixar projeto" }));

    expect(
      container.querySelectorAll(".chat-session__title")[0],
    ).toHaveTextContent("Beta");
    expect(screen.getByLabelText("Projeto fixado: Beta")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Opções de Beta" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "Usar cor violeta" }),
    );

    expect(screen.getByText("Beta").closest(".chat-session")).toHaveAttribute(
      "data-color",
      "violet",
    );
    expect(
      JSON.parse(
        localStorage.getItem("okami.code.project-preferences") ?? "null",
      ),
    ).toMatchObject({
      pinned: ["94e1d8f5-1369-4c75-89c9-3ac95f071091"],
      colors: {
        "94e1d8f5-1369-4c75-89c9-3ac95f071091": "violet",
      },
    });
  });

  it("opens a fresh workspace-free chat from the global action", async () => {
    renderApp("/workbench");

    await userEvent.click(
      await screen.findByRole("button", { name: "Nova conversa" }),
    );

    expect(window.location.hash).toMatch(/^#\/quick-chat\?new=.+/u);
    expect(
      await screen.findByRole("heading", { name: "Chat rápido" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("complementary", { name: "Projetos do Code" }),
    ).toBeNull();
  });

  it("groups expanded destinations in a predictable work, intelligence and system order", async () => {
    renderApp("/workbench");

    const navigation = await screen.findByRole("navigation", {
      name: "Navegação principal",
    });
    expect(
      within(navigation)
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["Trabalho", "Inteligência", "Sistema"]);
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual([
      "Início",
      "Code",
      "Inbox",
      "Agenda",
      "Kanban",
      "Agentes",
      "Modelos",
      "Memória",
      "Uso e limites",
      "Conexões",
      "Gestão",
      "Configurações",
    ]);
  });

  it("persists a collapsed navigation across routes while keeping destinations accessible", async () => {
    const user = userEvent.setup();
    renderApp("/workbench");

    await user.click(
      await screen.findByRole("button", { name: "Recolher navegação" }),
    );

    expect(localStorage.getItem("okami.navigation.collapsed")).toBe("true");
    expect(screen.queryByText("Nova conversa")).toBeNull();
    expect(screen.getByRole("link", { name: "Uso e limites" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Expandir navegação" }),
    ).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Inbox" }));

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Inbox" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeVisible();
    expect(screen.queryByText("Uso e limites")).toBeNull();
  });

  it("uses the global navigation on inbox instead of a route-specific rail", async () => {
    const { container } = renderApp("/inbox");

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const shell = container.querySelector(".inbox-shell");
    expect(shell).toBeTruthy();
    expect(shell?.firstElementChild).toHaveClass("navigation-rail");
    expect(shell?.firstElementChild).toHaveClass("navigation-rail--expanded");
    expect(shell?.lastElementChild).toHaveClass("inbox-shell__main");
  });
});
