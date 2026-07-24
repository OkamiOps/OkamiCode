import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createModelCatalogService,
  formatCursorModelLabel,
  parseCursorModelsFromCli,
  parseMiniMaxModelsFromCodeBundle,
  parseMimoModelsFromCli,
  parseNamedModelsFromCli,
} from "./model-catalog";

const locateLocalBinary = vi.hoisted(() => vi.fn(() => null));

vi.mock("../ecosystem/cli-capabilities", () => ({ locateLocalBinary }));

function cachePaths() {
  const directory = mkdtempSync(path.join(tmpdir(), "okami-model-catalog-"));
  return {
    claude: path.join(directory, "claude-models.json"),
    cursor: path.join(directory, "cursor-models.json"),
    agy: path.join(directory, "agy-models.json"),
    grok: path.join(directory, "grok-models.json"),
    minimax: path.join(directory, "minimax-models.json"),
    mimo: path.join(directory, "mimo-models.json"),
  };
}

describe("Cursor model catalog", () => {
  it("never rediscovers host binaries when managed commands or HTTP catalogs are supplied", () => {
    const paths = cachePaths();

    createModelCatalogService({
      cachePath: paths.claude,
      cursorBinary: "/managed/cursor-agent",
      agyBinary: "/managed/agy",
      grokBinary: "/managed/grok",
      opencodeBinary: "/managed/opencode",
      apiCatalogs: {
        mimo: [{ id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" }],
        minimax: [{ id: "MiniMax-M3", label: "MiniMax M3" }],
      },
    });

    expect(locateLocalBinary).not.toHaveBeenCalled();
  });

  it("keeps API-backed providers selectable without probing or installing their CLIs", () => {
    const paths = cachePaths();
    const service = createModelCatalogService({
      cachePath: paths.claude,
      grokBinary: null,
      apiCatalogs: {
        codex: [{ id: "gpt-test", label: "GPT Test" }],
        grok: [{ id: "grok-test", label: "Grok Test" }],
        mimo: [{ id: "mimo-test", label: "MiMo Test" }],
        minimax: [{ id: "MiniMax-Test", label: "MiniMax Test" }],
      },
    });

    for (const runtimeKind of ["codex", "grok", "mimo", "minimax"] as const) {
      expect(
        service.list().find((entry) => entry.runtimeKind === runtimeKind),
      ).toMatchObject({
        routeKind: "native",
        source: expect.stringMatching(/API do Okami/u),
      });
      expect(
        service.list().find((entry) => entry.runtimeKind === runtimeKind)
          ?.models[0]?.id,
      ).toBeTruthy();
    }
  });

  it("refreshes Codex from the account-aware app-server model list", async () => {
    const paths = cachePaths();
    const fetchCodexModels = vi.fn(async () => [
      {
        id: "gpt-provider-new",
        label: "GPT Provider New",
        efforts: ["low", "high"],
        defaultEffort: "high",
      },
    ]);
    const service = createModelCatalogService({
      cachePath: paths.claude,
      codexBinary: "/managed/codex",
      fetchCodexModels,
    });

    await service.refreshCodex();

    expect(fetchCodexModels).toHaveBeenCalledWith("/managed/codex");
    const codex = service.list().find((entry) => entry.runtimeKind === "codex");
    expect(codex?.routeKind).toBe("native");
    expect(codex?.models).toContainEqual(
      expect.objectContaining({ id: "gpt-provider-new" }),
    );
  });

  it("offers OpenCode only after the ACP command is verified", () => {
    const paths = cachePaths();
    const unavailable = createModelCatalogService({
      cachePath: paths.claude,
      opencodeBinary: "/real/opencode",
      opencodeAcpReady: false,
    });
    const ready = createModelCatalogService({
      cachePath: paths.claude,
      opencodeBinary: "/real/opencode",
      opencodeAcpReady: true,
    });

    expect(
      unavailable.list().find((entry) => entry.runtimeKind === "opencode"),
    ).toMatchObject({
      routeKind: "unavailable",
      models: [],
      source: expect.stringMatching(/ACP.*n.o.*comprovado/iu),
    });
    expect(
      ready.list().find((entry) => entry.runtimeKind === "opencode"),
    ).toMatchObject({
      routeKind: "native",
      models: [{ id: "default" }],
    });
  });

  it("extracts AGY models from pseudo-terminal output without treating logs as models", () => {
    expect(
      parseNamedModelsFromCli(
        [
          "^D\b\bI0721 23:10:16.037219 common.go:130] Launching CLI mode",
          "\r⠋ Fetching available models...",
          "I0721 23:10:17.989365 http_helpers.go:228] request completed",
          "\u001B[Kgemini-3.6-flash-high     Gemini 3.6 Flash (High)\r",
          "claude-opus-4-6-thinking  Claude Opus 4.6 (Thinking)\r",
        ].join("\n"),
      ),
    ).toEqual([
      {
        id: "gemini-3.6-flash-high",
        label: "Gemini 3.6 Flash (High)",
      },
      {
        id: "claude-opus-4-6-thinking",
        label: "Claude Opus 4.6 (Thinking)",
      },
    ]);
  });

  it("loads the real Antigravity model list instead of a fake automatic model", async () => {
    const paths = cachePaths();
    const executeNative = vi
      .fn()
      .mockResolvedValue(
        [
          "Fetching available models...",
          "gemini-3.6-flash-high     Gemini 3.6 Flash (High)",
          "gemini-3.5-flash-low      Gemini 3.5 Flash (Low)",
          "claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)",
        ].join("\n"),
      );
    const service = createModelCatalogService({
      cachePath: paths.claude,
      cursorCachePath: paths.cursor,
      cursorBinary: null,
      agyCachePath: paths.agy,
      agyBinary: "/real/agy",
      executeNative,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });

    await service.refreshAgy();

    expect(service.list().find((entry) => entry.runtimeKind === "agy")).toEqual(
      {
        runtimeKind: "agy",
        providerLabel: "Antigravity",
        routeKind: "native",
        source: "agy models · 2026-07-21T12:00:00.000Z",
        models: [
          {
            id: "gemini-3.6-flash-high",
            label: "Gemini 3.6 Flash (High)",
          },
          {
            id: "gemini-3.5-flash-low",
            label: "Gemini 3.5 Flash (Low)",
          },
          {
            id: "claude-sonnet-4-6",
            label: "Claude Sonnet 4.6 (Thinking)",
          },
        ],
      },
    );
    expect(executeNative).toHaveBeenCalledWith("/real/agy", ["models"]);
  });

  it("refreshes Grok from its native models command", async () => {
    const paths = cachePaths();
    const executeNative = vi
      .fn()
      .mockResolvedValue(
        "Default model: grok-build\n\nAvailable models:\n  * grok-build (default)\n",
      );
    const service = createModelCatalogService({
      cachePath: paths.claude,
      cursorBinary: null,
      agyBinary: null,
      grokCachePath: paths.grok,
      grokBinary: "/real/grok",
      executeNative,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });

    await service.refreshGrok();

    expect(executeNative).toHaveBeenCalledWith("/real/grok", ["models"]);
    expect(
      service.list().find((entry) => entry.runtimeKind === "grok"),
    ).toEqual({
      runtimeKind: "grok",
      providerLabel: "Grok",
      routeKind: "native",
      source: "grok models · 2026-07-21T12:00:00.000Z",
      models: [{ id: "grok-build", label: "grok-build" }],
    });
  });

  it("parses the exact catalog emitted by MiMo Code without inventing aliases", () => {
    expect(
      parseMimoModelsFromCli(
        [
          "mimo/mimo-auto",
          "xiaomi/mimo-v2.5",
          "xiaomi/mimo-v2.5-pro",
          "xiaomi/mimo-v2.5-pro-ultraspeed",
        ].join("\n"),
      ),
    ).toEqual([
      { id: "mimo/mimo-auto", label: "Automático" },
      { id: "xiaomi/mimo-v2.5", label: "MiMo V2.5" },
      { id: "xiaomi/mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
      {
        id: "xiaomi/mimo-v2.5-pro-ultraspeed",
        label: "MiMo V2.5 Pro Ultraspeed",
      },
    ]);
  });

  it("refreshes Token Plan catalogs from each provider instead of seeded models", async () => {
    const paths = cachePaths();
    const fetchModels = vi.fn(async (baseUrl: string, token: string) => {
      expect(token).toMatch(/^(tp-|sk-cp-)/u);
      return baseUrl.includes("xiaomimimo")
        ? [
            { id: "mimo-v2.5", label: "mimo-v2.5" },
            { id: "mimo-v2.5-pro", label: "mimo-v2.5-pro" },
          ]
        : [
            { id: "MiniMax-M2.7", label: "MiniMax-M2.7" },
            {
              id: "MiniMax-M2.7-highspeed",
              label: "MiniMax-M2.7-highspeed",
            },
          ];
    });
    const service = createModelCatalogService({
      cachePath: paths.claude,
      tokenPlanCredentials: {
        get: vi.fn(async (provider: "mimo" | "minimax") =>
          provider === "mimo"
            ? {
                token: "tp-live",
                baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
              }
            : { token: "sk-cp-live" },
        ),
      },
      fetchModels,
    });

    await service.refreshTokenPlans();

    expect(
      service.list().find((entry) => entry.runtimeKind === "mimo")?.models,
    ).toHaveLength(2);
    expect(
      service.list().find((entry) => entry.runtimeKind === "minimax")?.models,
    ).toHaveLength(2);
    expect(fetchModels).toHaveBeenCalledWith(
      "https://api.minimax.io/v1",
      "sk-cp-live",
    );
  });

  it("reads only the MiniMax provider models bundled by the installed MiniMax Code app", () => {
    const bundle = String.raw`
      \"minimax\": {
        \"MiniMax-M2.7\": { \"provider\": \"minimax\" },
        \"MiniMax-M2.7-highspeed\": { \"provider\": \"minimax\" },
        \"MiniMax-M3\": { \"provider\": \"minimax\" }
      },
      \"minimax-cn\": {
        \"MiniMax-M2.7\": { \"provider\": \"minimax-cn\" }
      },
      \"openrouter\": {
        \"minimax/minimax-m2.5\": {}
      }
    `;

    expect(parseMiniMaxModelsFromCodeBundle(bundle)).toEqual([
      { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
      {
        id: "MiniMax-M2.7-highspeed",
        label: "MiniMax M2.7 Highspeed",
      },
      { id: "MiniMax-M3", label: "MiniMax M3" },
    ]);
  });

  it("reads the minified MiniMax provider block shipped by the desktop renderer", () => {
    const bundle =
      'other:{models:{"MiniMax-Fake":{}}},minimax:{name:"MiniMax",models:{"MiniMax-M2.7":{},"MiniMax-M2.7-highspeed":{},"MiniMax-M3":{}}},gemini:{models:{"MiniMax-Fake":{}}}';

    expect(parseMiniMaxModelsFromCodeBundle(bundle)).toEqual([
      { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
      {
        id: "MiniMax-M2.7-highspeed",
        label: "MiniMax M2.7 Highspeed",
      },
      { id: "MiniMax-M3", label: "MiniMax M3" },
    ]);
  });

  it("keeps MiMo and MiniMax catalogs on their configured HTTP transports", () => {
    const paths = cachePaths();
    const executeNative = vi.fn();
    const service = createModelCatalogService({
      cachePath: paths.claude,
      apiCatalogs: {
        minimax: [{ id: "MiniMax-M3", label: "MiniMax M3" }],
        mimo: [{ id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" }],
      },
      executeNative,
    });

    expect(executeNative).not.toHaveBeenCalled();
    expect(
      service.list().find((entry) => entry.runtimeKind === "minimax"),
    ).toMatchObject({
      providerLabel: "MiniMax",
      routeKind: "native",
      source: "API do Okami · catálogo configurado",
      models: [{ id: "MiniMax-M3" }],
    });
    expect(
      service.list().find((entry) => entry.runtimeKind === "mimo"),
    ).toMatchObject({
      providerLabel: "MiMo",
      routeKind: "native",
      source: "API do Okami · catálogo configurado",
      models: [{ id: "mimo-v2.5-pro" }],
    });
  });

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

  it("refreshes Cursor through its account-aware models command and serves the separate cached catalog", async () => {
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
      "models",
    ]);
    expect(
      service.list().find((entry) => entry.runtimeKind === "cursor"),
    ).toEqual({
      runtimeKind: "cursor",
      providerLabel: "Cursor",
      routeKind: "native",
      source: "cursor-agent models · 2026-07-21T12:00:00.000Z",
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
      source: "cursor-agent models · 2026-07-20T12:00:00.000Z",
      models: [{ id: "gpt-5.3-codex" }],
    });
    expect(JSON.parse(readFileSync(paths.cursor, "utf8"))).toMatchObject({
      fetchedAt: "2026-07-20T12:00:00.000Z",
      models: [{ id: "gpt-5.3-codex" }],
    });
  });

  it("does not invent a Cursor model when no account catalog is available", () => {
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
      routeKind: "unavailable",
      source: "Cursor CLI não encontrado",
      models: [],
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
