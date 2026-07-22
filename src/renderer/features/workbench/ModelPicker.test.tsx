import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalog } from "./api";
import { ModelPicker } from "./ModelPicker";

const catalog = [
  {
    runtimeKind: "claude",
    providerLabel: "Claude",
    routeKind: "native",
    source: "fixture",
    models: [{ id: "sonnet", label: "Sonnet" }],
  },
  {
    runtimeKind: "codex",
    providerLabel: "Codex",
    routeKind: "native",
    source: "fixture",
    models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }],
  },
] satisfies ModelCatalog;

afterEach(cleanup);

describe("ModelPicker favorites provider", () => {
  it("makes the provider rail keyboard-focusable so overflowing providers can scroll", () => {
    render(
      <ModelPicker
        catalog={catalog}
        favorites={[]}
        isOpening={false}
        onSelectModel={vi.fn()}
        selectedLane={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Selecionar modelo" }));

    expect(screen.getByRole("tablist", { name: "Providers" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("groups persisted favorites and selects using their original runtime", () => {
    const onSelectModel = vi.fn();
    render(
      <ModelPicker
        catalog={catalog}
        favorites={[
          { runtimeKind: "claude", modelId: "sonnet" },
          { runtimeKind: "codex", modelId: "gpt-5.6-sol" },
        ]}
        isOpening={false}
        onSelectModel={onSelectModel}
        selectedLane={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Selecionar modelo" }));
    fireEvent.click(screen.getByRole("tab", { name: /Favoritos/u }));
    fireEvent.click(screen.getByRole("option", { name: /GPT-5\.6 Sol/u }));

    expect(onSelectModel).toHaveBeenCalledWith("codex", "gpt-5.6-sol");
  });

  it("keeps an empty Favorites provider discoverable", () => {
    render(
      <ModelPicker
        catalog={catalog}
        favorites={[]}
        isOpening={false}
        onSelectModel={vi.fn()}
        selectedLane={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Selecionar modelo" }));
    fireEvent.click(screen.getByRole("tab", { name: /Favoritos/u }));

    expect(
      screen.getByText("Marque modelos com estrela na tela Modelos."),
    ).toBeInTheDocument();
  });
});
