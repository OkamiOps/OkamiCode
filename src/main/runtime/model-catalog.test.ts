import { describe, expect, it } from "vitest";
import { createModelCatalogService } from "./model-catalog";

describe("model catalog", () => {
  it("exposes Cursor as its own native subscription without inventing account models", () => {
    const service = createModelCatalogService({
      cachePath: "/tmp/okami-model-catalog-missing/cursor-test.json",
    });

    expect(
      service.list().find((entry) => entry.runtimeKind === "cursor"),
    ).toEqual({
      runtimeKind: "cursor",
      providerLabel: "Cursor",
      routeKind: "native",
      source:
        "seleção automática do cursor-agent; catálogo da conta exige login",
      models: [
        {
          id: "default",
          label: "Automático",
          description: "Modelo padrão configurado na assinatura Cursor",
        },
      ],
    });
  });
});
