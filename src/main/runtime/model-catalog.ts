import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import readline from "node:readline";

export interface CatalogModel {
  id: string;
  label: string;
  description?: string;
  efforts?: string[];
  defaultEffort?: string;
}

export interface ModelCatalogEntry {
  runtimeKind: "claude" | "codex";
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

export interface ModelCatalogService {
  list(): ModelCatalogEntry[];
  refreshClaude(): Promise<void>;
}

// Serves the catalog instantly from cache while a background refresh asks the
// CLI for the authoritative list (which reflects the account's entitlements).
export function createModelCatalogService(options: {
  cachePath: string;
}): ModelCatalogService {
  let claude: PersistedClaudeCatalog | null = null;
  let refreshing: Promise<void> | null = null;
  try {
    claude = JSON.parse(
      readFileSync(options.cachePath, "utf8"),
    ) as PersistedClaudeCatalog;
  } catch {
    claude = null;
  }

  const refreshClaude = async () => {
    refreshing ??= (async () => {
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
        refreshing = null;
      }
    })();
    await refreshing;
  };

  return {
    refreshClaude,
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
      ];
    },
  };
}
