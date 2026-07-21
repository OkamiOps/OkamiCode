import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { spawn as spawnPty } from "node-pty";
import type { RuntimeKind } from "../../shared/contracts/lane";
import { locateLocalBinary } from "../ecosystem/cli-capabilities";

const execFileAsync = promisify(execFile);

export interface CatalogModel {
  id: string;
  label: string;
  description?: string;
  efforts?: string[];
  defaultEffort?: string;
}

export interface ModelCatalogEntry {
  runtimeKind: RuntimeKind;
  providerLabel: string;
  routeKind: "direct" | "compatible" | "bridged" | "native" | "unavailable";
  source: string;
  models: CatalogModel[];
}

interface CodexCachedModel {
  slug?: string;
  display_name?: string;
  description?: string;
  visibility?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{ effort?: string }>;
}

interface ClaudeListedModel {
  value?: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  defaultEffortLevel?: string;
}

export function readCodexModelsCache(
  cachePath = path.join(homedir(), ".codex", "models_cache.json"),
): CatalogModel[] {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
      models?: CodexCachedModel[];
    };
    return (parsed.models ?? [])
      .filter(
        (model): model is CodexCachedModel & { slug: string } =>
          typeof model.slug === "string" && model.visibility === "list",
      )
      .map((model) => {
        const efforts = (model.supported_reasoning_levels ?? [])
          .map((level) => level.effort)
          .filter((effort): effort is string => typeof effort === "string");
        return {
          id: model.slug,
          label: model.display_name ?? model.slug,
          ...(model.description ? { description: model.description } : {}),
          ...(efforts.length > 0 ? { efforts } : {}),
          ...(model.default_reasoning_level
            ? { defaultEffort: model.default_reasoning_level }
            : {}),
        };
      });
  } catch {
    return [];
  }
}

function locateClaudeBinary(): string | null {
  const candidates = [
    path.join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  try {
    candidates.unshift(
      execFileSync("/usr/bin/which", ["claude"], { encoding: "utf8" }).trim(),
    );
  } catch {
    // PATH lookups fail inside the packaged app; the fixed candidates cover it.
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return realpathSync(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

// Asks the running CLI for its real model picker via the stream-json control
// protocol (`list_models`). Costs no turn: the session is killed right after
// the control response arrives.
export function fetchClaudeModelsFromCli(
  timeoutMs = 150_000,
): Promise<CatalogModel[]> {
  return new Promise((resolve, reject) => {
    const requestId = `okami-models-${randomUUID()}`;
    const child = spawn(
      "claude",
      [
        "--print",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--session-id",
        randomUUID(),
      ],
      { stdio: ["pipe", "pipe", "ignore"], env: process.env },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("list_models timed out"));
    }, timeoutMs);
    const finish = (result: CatalogModel[] | Error) => {
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    readline
      .createInterface({ input: child.stdout, crlfDelay: Infinity })
      .on("line", (line) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (parsed.type !== "control_response") return;
        const response = parsed.response as
          | {
              subtype?: string;
              request_id?: string;
              response?: { models?: ClaudeListedModel[] };
              error?: string;
            }
          | undefined;
        if (response?.request_id !== requestId) return;
        if (response.subtype !== "success") {
          finish(new Error(response.error ?? "list_models failed"));
          return;
        }
        const models = (response.response?.models ?? [])
          .filter(
            (model): model is ClaudeListedModel & { value: string } =>
              typeof model.value === "string",
          )
          .map((model) => ({
            id: model.value,
            label: model.displayName ?? model.value,
            ...(model.description ? { description: model.description } : {}),
            ...(model.supportsEffort && model.supportedEffortLevels?.length
              ? {
                  efforts: model.supportedEffortLevels,
                  ...(model.defaultEffortLevel
                    ? { defaultEffort: model.defaultEffortLevel }
                    : {}),
                }
              : {}),
          }));
        finish(models);
      });
    child.on("error", (error) => finish(error));
    child.on("exit", () =>
      finish(new Error("claude exited before answering list_models")),
    );
    child.stdin.write(
      `${JSON.stringify({
        type: "control_request",
        request_id: requestId,
        request: { subtype: "list_models" },
      })}\n`,
    );
  });
}

// Display order for known Claude families; unknown families keep the CLI
// order after these. The list itself stays whatever list_models returned.
const CLAUDE_FAMILY_ORDER = ["fable", "opus", "sonnet", "haiku"];

export function orderClaudeModels(models: CatalogModel[]): CatalogModel[] {
  const family = (model: CatalogModel) => {
    const haystack = `${model.id} ${model.label}`.toLowerCase();
    const index = CLAUDE_FAMILY_ORDER.findIndex((name) =>
      haystack.includes(name),
    );
    return index === -1 ? CLAUDE_FAMILY_ORDER.length : index;
  };
  // "Default (recommended)" duplicates another entry (same description);
  // dropping the alias keeps the picker short without hiding a real model.
  const deduped = models.filter(
    (model) =>
      model.id !== "default" ||
      !models.some(
        (other) =>
          other.id !== "default" &&
          other.description !== undefined &&
          other.description === model.description,
      ),
  );
  return [...deduped].sort((left, right) => family(left) - family(right));
}

interface PersistedClaudeCatalog {
  cliPath: string;
  fetchedAt: string;
  models: CatalogModel[];
}

interface PersistedCursorCatalog {
  cliPath: string;
  fetchedAt: string;
  models: CatalogModel[];
}

export type CursorModelListExecutor = (
  binaryPath: string,
  args: string[],
) => Promise<string>;

export interface ModelCatalogServiceOptions {
  cachePath: string;
  cursorCachePath?: string;
  cursorBinary?: string | null;
  executeCursor?: CursorModelListExecutor;
  agyCachePath?: string;
  agyBinary?: string | null;
  grokCachePath?: string;
  grokBinary?: string | null;
  executeNative?: CursorModelListExecutor;
  now?: () => Date;
}

const ANSI_ESCAPE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);
const CURSOR_PARAMETER = "[A-Za-z][A-Za-z0-9_-]*=[^,\\]\\s]+";
const CURSOR_MODEL_ID = new RegExp(
  `^[A-Za-z][A-Za-z0-9._:/-]*(?:\\[${CURSOR_PARAMETER}(?:,${CURSOR_PARAMETER})*\\])?$`,
  "u",
);

function cursorModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!CURSOR_MODEL_ID.test(id)) return null;
  const base = id.split("[", 1)[0] ?? id;
  // Requiring both a version-like digit and a separator avoids treating
  // headings and ordinary status text as models.
  if (!/[0-9]/u.test(base) || !/[-_.]/u.test(base)) return null;
  return id;
}

function cursorModelsFromJson(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? (value as { models?: unknown }).models
      : undefined;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (typeof item !== "object" || item === null) return [];
    const record = item as { id?: unknown; value?: unknown };
    return [record.id, record.value].filter(
      (candidate): candidate is string => typeof candidate === "string",
    );
  });
}

function cursorBaseAndParameters(id: string): {
  base: string;
  parameters: string[];
} {
  const bracket = id.indexOf("[");
  if (bracket === -1) return { base: id, parameters: [] };
  return {
    base: id.slice(0, bracket),
    parameters: id
      .slice(bracket + 1, -1)
      .split(",")
      .filter((parameter) => parameter.includes("=")),
  };
}

const CURSOR_LABEL_WORDS: Record<string, string> = {
  gpt: "GPT",
  claude: "Claude",
  grok: "Grok",
  gemini: "Gemini",
  composer: "Composer",
};

function titleCaseModelWord(value: string): string {
  return (
    CURSOR_LABEL_WORDS[value.toLowerCase()] ??
    `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
  );
}

// The label is display-only. The raw ID remains the value passed back to the
// Cursor CLI, including every bracket parameter it returned.
export function formatCursorModelLabel(id: string): string {
  const { base } = cursorBaseAndParameters(id);
  const parts = base.split("-");
  const label: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    const next = parts[index + 1];
    if (/^\d+$/u.test(part) && next && /^\d+$/u.test(next)) {
      label.push(`${part}.${next}`);
      index += 1;
      continue;
    }
    label.push(/^\d+(?:\.\d+)*$/u.test(part) ? part : titleCaseModelWord(part));
  }
  return label.join(" ");
}

function asCursorCatalogModels(ids: readonly string[]): CatalogModel[] {
  const seen = new Set<string>();
  return ids.flatMap((candidate) => {
    const id = cursorModelId(candidate);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    // Cursor models can include bracket parameters. Keep every observed
    // variant independent rather than guessing whether an effort switch is
    // supported by this CLI version.
    const { parameters } = cursorBaseAndParameters(id);
    return [
      {
        id,
        label: formatCursorModelLabel(id),
        description:
          parameters.length > 0
            ? `Parâmetros observados: ${parameters.join(" · ")}`
            : `ID técnico: ${id}`,
      },
    ];
  });
}

// Cursor exposes `models` as its account-aware, read-only catalog command.
// No prompt, print mode, session, login, or model turn is involved here.
export function parseCursorModelsFromCli(output: string): CatalogModel[] {
  const clean = output.replace(ANSI_ESCAPE, "").trim();
  if (!clean) return [];
  try {
    const json = JSON.parse(clean) as unknown;
    return asCursorCatalogModels(cursorModelsFromJson(json));
  } catch {
    // The current CLI emits text. JSON is only a forward-compatible path.
  }

  return asCursorCatalogModels(
    clean.split(/\r?\n/u).flatMap((line) => {
      if (
        /\b(error|not logged|login|sign in|unauthorized|forbidden|failed)\b/iu.test(
          line,
        )
      ) {
        return [];
      }
      const normalized = line.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/u, "");
      const [candidate] = normalized.split(/\s+/u);
      return candidate ? [candidate] : [];
    }),
  );
}

async function executeCursorModelList(
  binaryPath: string,
  args: string[],
): Promise<string> {
  const { stdout, stderr } = await execFileAsync(binaryPath, args, {
    env: process.env,
    timeout: 10_000,
    windowsHide: true,
  });
  return `${stdout}\n${stderr}`;
}

function executeAgyModelList(binaryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const terminal = spawnPty(binaryPath, ["models"], {
      cols: 120,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      name: "xterm-256color",
      rows: 40,
    });
    let output = "";
    let settled = false;
    const finish = (result: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > 4 * 1024 * 1024) {
        terminal.kill();
        finish(new Error("agy models output exceeded the safe limit"));
      }
    };
    terminal.onData((data) => append(Buffer.from(data, "utf8")));
    terminal.onExit(({ exitCode }) => {
      if (exitCode === 0) finish(output);
      else finish(new Error("agy models exited before returning a catalog"));
    });
    const timer = setTimeout(() => {
      terminal.kill();
      finish(new Error("agy models timed out"));
    }, 30_000);
  });
}

function readCursorCatalog(cachePath: string): PersistedCursorCatalog | null {
  try {
    const parsed = JSON.parse(
      readFileSync(cachePath, "utf8"),
    ) as Partial<PersistedCursorCatalog>;
    const models = asCursorCatalogModels(
      parsed.models?.map((model) => model.id) ?? [],
    );
    if (
      typeof parsed.cliPath !== "string" ||
      typeof parsed.fetchedAt !== "string" ||
      models.length === 0
    ) {
      return null;
    }
    return { cliPath: parsed.cliPath, fetchedAt: parsed.fetchedAt, models };
  } catch {
    return null;
  }
}

function readNamedCatalog(cachePath: string): PersistedCursorCatalog | null {
  try {
    const parsed = JSON.parse(
      readFileSync(cachePath, "utf8"),
    ) as Partial<PersistedCursorCatalog>;
    const models = (parsed.models ?? []).filter(
      (model): model is CatalogModel =>
        typeof model?.id === "string" &&
        model.id.length > 0 &&
        typeof model.label === "string" &&
        model.label.length > 0,
    );
    if (
      typeof parsed.cliPath !== "string" ||
      typeof parsed.fetchedAt !== "string" ||
      models.length === 0
    ) {
      return null;
    }
    return { cliPath: parsed.cliPath, fetchedAt: parsed.fetchedAt, models };
  } catch {
    return null;
  }
}

export function parseNamedModelsFromCli(output: string): CatalogModel[] {
  const clean = output.replace(ANSI_ESCAPE, "");
  // PTYs redraw spinners with bare carriage returns. Treat those redraws as
  // line boundaries so the first model is not glued to the progress marker.
  const lines = clean.split(/\r\n|\r|\n/u).map((line) => line.trim());
  const marker = lines.findIndex((line) =>
    /(?:available models:|fetching available models\.\.\.)/iu.test(line),
  );
  const candidates = marker >= 0 ? lines.slice(marker + 1) : lines;
  const seen = new Set<string>();
  return candidates.flatMap((line) => {
    const value = line
      .replace(/^\*\s+/u, "")
      .replace(/\s+\(default\)$/iu, "")
      .trim();
    if (
      !value ||
      value.length > 120 ||
      /(?:^|\s)[IEWF]\d{4}\s/u.test(value) ||
      /fetching available models/iu.test(value) ||
      /\b(error|failed|warning|not authenticated|not logged)\b/iu.test(value)
    )
      return [];
    if (seen.has(value)) return [];
    const columns = /^([a-z0-9][a-z0-9._:/-]+)\s{2,}(.+)$/u.exec(value);
    const id = columns?.[1] ?? value;
    const label = columns?.[2]?.trim() || id;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, label }];
  });
}

export interface ModelCatalogService {
  list(): ModelCatalogEntry[];
  refreshClaude(): Promise<void>;
  refreshCursor(): Promise<void>;
  refreshAgy(): Promise<void>;
  refreshGrok(): Promise<void>;
}

// Serves the catalog instantly from cache while a background refresh asks the
// CLI for the authoritative list (which reflects the account's entitlements).
export function createModelCatalogService(
  options: ModelCatalogServiceOptions,
): ModelCatalogService {
  let claude: PersistedClaudeCatalog | null = null;
  let cursor: PersistedCursorCatalog | null = null;
  let agy: PersistedCursorCatalog | null = null;
  let grok: PersistedCursorCatalog | null = null;
  let refreshingClaude: Promise<void> | null = null;
  let refreshingCursor: Promise<void> | null = null;
  let refreshingAgy: Promise<void> | null = null;
  let refreshingGrok: Promise<void> | null = null;
  const cursorCachePath =
    options.cursorCachePath ??
    path.join(path.dirname(options.cachePath), "cursor-models.json");
  const cursorBinary =
    options.cursorBinary === undefined
      ? locateLocalBinary("cursor")
      : options.cursorBinary;
  const agyCachePath =
    options.agyCachePath ??
    path.join(path.dirname(options.cachePath), "agy-models.json");
  const agyBinary =
    options.agyBinary === undefined
      ? locateLocalBinary("agy")
      : options.agyBinary;
  const grokCachePath =
    options.grokCachePath ??
    path.join(path.dirname(options.cachePath), "grok-models.json");
  const grokBinary =
    options.grokBinary === undefined
      ? locateLocalBinary("grok")
      : options.grokBinary;
  const executeCursor = options.executeCursor ?? executeCursorModelList;
  const executeNative = options.executeNative ?? executeCursorModelList;
  const now = options.now ?? (() => new Date());
  try {
    claude = JSON.parse(
      readFileSync(options.cachePath, "utf8"),
    ) as PersistedClaudeCatalog;
  } catch {
    claude = null;
  }
  cursor = readCursorCatalog(cursorCachePath);
  agy = readNamedCatalog(agyCachePath);
  grok = readNamedCatalog(grokCachePath);

  const refreshClaude = async () => {
    refreshingClaude ??= (async () => {
      try {
        const models = await fetchClaudeModelsFromCli();
        if (models.length === 0) return;
        claude = {
          cliPath: locateClaudeBinary() ?? "claude",
          fetchedAt: new Date().toISOString(),
          models,
        };
        mkdirSync(path.dirname(options.cachePath), { recursive: true });
        writeFileSync(options.cachePath, JSON.stringify(claude, null, 2));
        console.log(
          "[okami] claude list_models refreshed:",
          models.map((model) => model.id).join(", "),
        );
      } catch (error) {
        console.error("[okami] claude list_models failed", error);
      } finally {
        refreshingClaude = null;
      }
    })();
    await refreshingClaude;
  };

  const refreshCursor = async () => {
    refreshingCursor ??= (async () => {
      try {
        if (!cursorBinary) return;
        const models = parseCursorModelsFromCli(
          await executeCursor(cursorBinary, ["models"]),
        );
        if (models.length === 0) return;
        cursor = {
          cliPath: cursorBinary,
          fetchedAt: now().toISOString(),
          models,
        };
        mkdirSync(path.dirname(cursorCachePath), { recursive: true });
        writeFileSync(cursorCachePath, JSON.stringify(cursor, null, 2));
        console.log("[okami] Cursor model catalog refreshed");
      } catch {
        // The CLI can return account/auth failures. Never leak its output and
        // keep the last known-good local catalog intact.
        console.error("[okami] Cursor model catalog refresh failed");
      } finally {
        refreshingCursor = null;
      }
    })();
    await refreshingCursor;
  };

  const refreshAgy = async () => {
    refreshingAgy ??= (async () => {
      try {
        if (!agyBinary) return;
        // `agy models` waits indefinitely when stdout is a plain pipe. A
        // node-pty session gives its picker the terminal it expects while
        // still returning captured text to the desktop process. Injected
        // executors stay unwrapped so tests remain deterministic.
        const output = options.executeNative
          ? await executeNative(agyBinary, ["models"])
          : await executeAgyModelList(agyBinary);
        const models = parseNamedModelsFromCli(output);
        if (models.length === 0) return;
        agy = { cliPath: agyBinary, fetchedAt: now().toISOString(), models };
        mkdirSync(path.dirname(agyCachePath), { recursive: true });
        writeFileSync(agyCachePath, JSON.stringify(agy, null, 2));
        console.log("[okami] Antigravity model catalog refreshed");
      } catch {
        console.error("[okami] Antigravity model catalog refresh failed");
      } finally {
        refreshingAgy = null;
      }
    })();
    await refreshingAgy;
  };

  const refreshGrok = async () => {
    refreshingGrok ??= (async () => {
      try {
        if (!grokBinary) return;
        const models = parseNamedModelsFromCli(
          await executeNative(grokBinary, ["models"]),
        );
        if (models.length === 0) return;
        grok = { cliPath: grokBinary, fetchedAt: now().toISOString(), models };
        mkdirSync(path.dirname(grokCachePath), { recursive: true });
        writeFileSync(grokCachePath, JSON.stringify(grok, null, 2));
        console.log("[okami] Grok model catalog refreshed");
      } catch {
        console.error("[okami] Grok model catalog refresh failed");
      } finally {
        refreshingGrok = null;
      }
    })();
    await refreshingGrok;
  };

  return {
    refreshClaude,
    refreshCursor,
    refreshAgy,
    refreshGrok,
    list() {
      const codexModels = readCodexModelsCache();
      return [
        {
          runtimeKind: "claude",
          providerLabel: "Claude",
          routeKind: "direct",
          source: claude
            ? `list_models do Claude Code · ${claude.fetchedAt}`
            : "consultando o Claude Code (list_models)…",
          models: claude ? orderClaudeModels(claude.models) : [],
        },
        {
          runtimeKind: "codex",
          providerLabel: "ChatGPT",
          routeKind: "bridged",
          source:
            codexModels.length > 0
              ? "catálogo do Codex CLI (models_cache.json)"
              : "indisponível — cache do Codex não encontrado",
          models: codexModels,
        },
        {
          runtimeKind: "cursor",
          providerLabel: "Cursor",
          routeKind: "native",
          source: cursor
            ? `cursor-agent models · ${cursor.fetchedAt}`
            : cursorBinary
              ? "catálogo do Cursor indisponível — autentique o Cursor"
              : "Cursor CLI não encontrado",
          models: cursor?.models ?? [
            {
              id: "default",
              label: "Automático",
              description: "Modelo padrão configurado na assinatura Cursor",
            },
          ],
        },
        {
          runtimeKind: "agy",
          providerLabel: "Antigravity",
          routeKind: "native",
          source: agy
            ? `agy models · ${agy.fetchedAt}`
            : agyBinary
              ? "consultando agy models…"
              : "Antigravity CLI não encontrado",
          models: agy?.models ?? [],
        },
        {
          runtimeKind: "grok",
          providerLabel: "Grok",
          routeKind: "native",
          source: grok
            ? `grok models · ${grok.fetchedAt}`
            : grokBinary
              ? "consultando grok models…"
              : "Grok CLI não encontrado",
          models: grok?.models ?? [],
        },
      ];
    },
  };
}
