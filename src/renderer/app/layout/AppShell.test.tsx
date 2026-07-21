import { cleanup, render, screen } from "@testing-library/react";
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

  it("shows the chat sidebar with the new conversation action", async () => {
    renderApp("/workbench");

    expect(
      await screen.findByRole("button", { name: "Nova conversa" }),
    ).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Histórico de conversas" }),
    ).toBeVisible();
  });

  it("uses the dedicated inbox shell without the coding conversation sidebar", async () => {
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
    expect(shell?.lastElementChild).toHaveClass("inbox-shell__main");
  });
});
