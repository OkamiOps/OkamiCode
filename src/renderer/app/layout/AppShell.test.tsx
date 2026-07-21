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

  it("keeps one expanded global navigation with workbench conversations", async () => {
    renderApp("/workbench");

    expect(
      await screen.findByRole("navigation", { name: "Navegação principal" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Workbench" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Histórico de conversas" }),
    ).toBeVisible();
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
      "Workbench",
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
    expect(screen.queryByText("Histórico de conversas")).toBeNull();
    expect(screen.getByRole("link", { name: "Uso e limites" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Expandir navegação" }),
    ).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Inbox" }));

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Inbox" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Nova conversa" })).toBeNull();
    expect(screen.queryByText("Uso e limites")).toBeNull();
  });

  it("uses the global navigation on inbox instead of a route-specific rail", async () => {
    const { container } = renderApp("/inbox");

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Nova conversa" })).toBeNull();
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
