import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryPicker } from "./MemoryPicker";

describe("MemoryPicker", () => {
  it("adds a memory ref only after the user explicitly clicks a result", async () => {
    const onSelect = vi.fn();
    const search = vi.fn(async () => [
      {
        id: 7,
        sourceId: "source-1",
        title: "Subscription Gateway",
        path: "/vault/Projetos/okami.md",
        excerpt: "The subscription gateway keeps accounts separate.",
        heading: "Subscription Gateway",
        citation: "okami.md#Subscription Gateway",
        score: 1,
      },
    ]);
    render(<MemoryPicker search={search} onSelect={onSelect} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Contexto" }));
    await user.type(screen.getByRole("searchbox"), "gateway");
    expect(onSelect).not.toHaveBeenCalled();
    await user.click(
      await screen.findByRole("button", { name: /Subscription Gateway/u }),
    );

    expect(onSelect).toHaveBeenCalledWith({
      label: "Subscription Gateway",
      ref: "memory:7",
    });
  });
});
