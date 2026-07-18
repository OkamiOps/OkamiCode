import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { installOkamiMock } from "../../test/okami-mock";

function renderApp(path: string) {
  window.history.replaceState({}, "", path);
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

  it("lets the workbench populate the list and details regions", async () => {
    renderApp("/workbench");

    expect(
      await screen.findByRole("region", { name: "Lista de tarefas" }),
    ).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "Detalhes da lane" }),
    ).toBeVisible();
  });
});
