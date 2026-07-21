import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createModelCatalogService,
  formatCursorModelLabel,
  parseCursorModelsFromCli,
} from "./model-catalog";

function cachePaths() {
  const directory = mkdtempSync(path.join(tmpdir(), "okami-model-catalog-"));
  return {
    claude: path.join(directory, "claude-models.json"),
    cursor: path.join(directory, "cursor-models.json"),
  };
}

describe("Cursor model catalog", () => {
  it("formats Cursor model labels without exposing parameter blocks", () => {
    expect(formatCursorModelLabel("gpt-5.3-codex")).toBe("GPT 5.3 Codex");
    expect(formatCursorModelLabel("claude-opus-4-8")).toBe("Claude Opus 4.8");
    expect(formatCursorModelLabel("grok-4-fast")).toBe("Grok 4 Fast");
    expect(formatCursorModelLabel("gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
    expect(formatCursorModelLabel("composer-1")).toBe("Composer 1");
    expect(
      formatCursorModelLabel(
        "claude-opus-4-8[context=1m,effort=high,fast=false]",
      ),
    ).toBe("Claude Opus 4.8");
  });

  it("parses only clear Cursor model IDs, strips ANSI, and keeps parameterized IDs intact", () => {
    expect(
      parseCursorModelsFromCli(
        [
          "\u001B[32mAvailable models:\u001B[0m",
          "  gpt-5.3-codex",
          "  claude-opus-4-8[context=1m,effort=high,fast=false]",
          "  claude-opus-4-8[context=1m,effort=low,fast=false]",
          "  gpt-5.3-codex",
          "Error: Not logged in",
        ].join("\n"),
      ),
    ).toEqual([
      {
        id: "gpt-5.3-codex",
        label: "GPT 5.3 Codex",
        description: "ID técnico: gpt-5.3-codex",
      },
      {
        id: "claude-opus-4-8[context=1m,effort=high,fast=false]",
        label: "Claude Opus 4.8",
        description:
          "Parâmetros observados: context=1m · effort=high · fast=false",
      },
      {
        id: "claude-opus-4-8[context=1m,effort=low,fast=false]",
        label: "Claude Opus 4.8",
        description:
          "Parâmetros observados: context=1m · effort=low · fast=false",
      },
    ]);
  });

  it("accepts the documented JSON-shaped CLI output without accepting unrelated fields", () => {
    expect(
      parseCursorModelsFromCli(
        JSON.stringify({
          models: [
            { id: "gpt-5.3-codex" },
            { value: "claude-sonnet-4-5" },
            { id: "Not a model" },
          ],
          error: "Not logged in",
        }),
      ),
    ).toEqual([
      {
        id: "gpt-5.3-codex",
        label: "GPT 5.3 Codex",
        description: "ID técnico: gpt-5.3-codex",
      },
      {
        id: "claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        description: "ID técnico: claude-sonnet-4-5",
      },
    ]);
  });

  it("refreshes Cursor through only --list-models and serves the separate cached catalog", async () => {
    const paths = cachePaths();
    const executeCursor = vi
      .fn()
      .mockResolvedValue("gpt-5.3-codex\nclaude-sonnet-4-5\n");
    const service = createModelCatalogService({
      cachePath: paths.claude,
      cursorCachePath: paths.cursor,
      cursorBinary: "/real/cursor-agent",
      executeCursor,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });

    await service.refreshCursor();

    expect(executeCursor).toHaveBeenCalledWith("/real/cursor-agent", [
      "--list-models",
    ]);
    expect(
      service.list().find((entry) => entry.runtimeKind === "cursor"),
    ).toEqual({
      runtimeKind: "cursor",
      providerLabel: "Cursor",
      routeKind: "native",
      source: "--list-models do Cursor CLI · 2026-07-21T12:00:00.000Z",
      models: [
        {
          id: "gpt-5.3-codex",
          label: "GPT 5.3 Codex",
          description: "ID técnico: gpt-5.3-codex",
        },
        {
          id: "claude-sonnet-4-5",
          label: "Claude Sonnet 4.5",
          description: "ID técnico: claude-sonnet-4-5",
        },
      ],
    });
    expect(JSON.parse(readFileSync(paths.cursor, "utf8"))).toMatchObject({
      cliPath: "/real/cursor-agent",
      fetchedAt: "2026-07-21T12:00:00.000Z",
      models: [{ id: "gpt-5.3-codex" }, { id: "claude-sonnet-4-5" }],
    });
  });

  it("keeps the last valid Cursor catalog after an auth error or an empty response", async () => {
    const paths = cachePaths();
    writeFileSync(
      paths.cursor,
      JSON.stringify({
        cliPath: "/real/cursor-agent",
        fetchedAt: "2026-07-20T12:00:00.000Z",
        models: [
          {
            id: "gpt-5.3-codex",
            label: "GPT 5.3 Codex",
            description: "ID técnico: gpt-5.3-codex",
          },
        ],
      }),
    );
    const executeCursor = vi
      .fn()
      .mockRejectedValueOnce(new Error("Not logged in"))
      .mockResolvedValueOnce("Available models:\n");
    const service = createModelCatalogService({
      cachePath: paths.claude,
      cursorCachePath: paths.cursor,
      cursorBinary: "/real/cursor-agent",
      executeCursor,
    });

    await service.refreshCursor();
    await service.refreshCursor();

    expect(
      service.list().find((entry) => entry.runtimeKind === "cursor"),
    ).toMatchObject({
      source: "--list-models do Cursor CLI · 2026-07-20T12:00:00.000Z",
      models: [{ id: "gpt-5.3-codex" }],
    });
    expect(JSON.parse(readFileSync(paths.cursor, "utf8"))).toMatchObject({
      fetchedAt: "2026-07-20T12:00:00.000Z",
      models: [{ id: "gpt-5.3-codex" }],
    });
  });

  it("keeps an honest automatic fallback when no Cursor catalog is cached", () => {
    const paths = cachePaths();
    const service = createModelCatalogService({
      cachePath: paths.claude,
      cursorCachePath: paths.cursor,
      cursorBinary: null,
    });

    expect(
      service.list().find((entry) => entry.runtimeKind === "cursor"),
    ).toEqual({
      runtimeKind: "cursor",
      providerLabel: "Cursor",
      routeKind: "native",
      source: "Cursor CLI não encontrado",
      models: [
        {
          id: "default",
          label: "Automático",
          description: "Modelo padrão configurado na assinatura Cursor",
        },
      ],
    });
  });

  it("distinguishes an available CLI without a catalog from a missing CLI", () => {
    const paths = cachePaths();
    const service = createModelCatalogService({
      cachePath: paths.claude,
      cursorCachePath: paths.cursor,
      cursorBinary: "/real/cursor-agent",
    });

    expect(
      service.list().find((entry) => entry.runtimeKind === "cursor")?.source,
    ).toBe("catálogo do Cursor indisponível — autentique o Cursor");
  });
});
