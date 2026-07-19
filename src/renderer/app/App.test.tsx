import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { installOkamiMock } from "../test/okami-mock";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => {
    installOkamiMock({ "task:list": [], "lane:list": [] });
  });

  it("renders the Workbench product identity", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Nova conversa" })).toBeVisible();
  });
});
