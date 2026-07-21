import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ModelFavoritesService } from "./model-favorites";

function favoritesPath(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "okami-model-favorites-")),
    "favorites.json",
  );
}

describe("ModelFavoritesService", () => {
  it("persists favorites across service instances", () => {
    const filePath = favoritesPath();
    const service = new ModelFavoritesService({ filePath });

    service.set({
      runtimeKind: "codex",
      modelId: "gpt-5.6-sol",
      favorite: true,
    });

    expect(new ModelFavoritesService({ filePath }).list()).toEqual([
      { runtimeKind: "codex", modelId: "gpt-5.6-sol" },
    ]);
  });

  it("uses provider and model as the identity and removes only that favorite", () => {
    const service = new ModelFavoritesService({ filePath: favoritesPath() });
    service.set({ runtimeKind: "codex", modelId: "default", favorite: true });
    service.set({ runtimeKind: "claude", modelId: "default", favorite: true });

    expect(
      service.set({
        runtimeKind: "codex",
        modelId: "default",
        favorite: false,
      }),
    ).toEqual([{ runtimeKind: "claude", modelId: "default" }]);
  });

  it("recovers safely from a malformed favorites file", () => {
    const filePath = favoritesPath();
    writeFileSync(filePath, "not-json", "utf8");

    expect(new ModelFavoritesService({ filePath }).list()).toEqual([]);
  });
});
