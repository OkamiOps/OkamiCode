import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface CatalogModel {
  id: string;
  label: string;
  description?: string;
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
}

// The same set the Claude Code `/model` picker offers for subscription auth.
// The CLI resolves each alias to the subscription's current model.
const CLAUDE_CLI_MODELS: CatalogModel[] = [
  { id: "opus", label: "Opus", description: "Modelo mais capaz" },
  {
    id: "sonnet",
    label: "Sonnet",
    description: "Equilíbrio entre custo e capacidade",
  },
  { id: "haiku", label: "Haiku", description: "Rápido e econômico" },
  {
    id: "opusplan",
    label: "Opus Plan",
    description: "Opus para planejar, Sonnet para executar",
  },
];

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
      .map((model) => ({
        id: model.slug,
        label: model.display_name ?? model.slug,
        ...(model.description ? { description: model.description } : {}),
      }));
  } catch {
    return [];
  }
}

// Built fresh on every models:list call so a CLI update that changes the
// available models is reflected without restarting the app.
export function buildModelCatalog(): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [
    {
      runtimeKind: "claude",
      providerLabel: "Claude",
      routeKind: "direct",
      source: "aliases do Claude Code (/model)",
      models: CLAUDE_CLI_MODELS,
    },
  ];
  const codexModels = readCodexModelsCache();
  entries.push({
    runtimeKind: "codex",
    providerLabel: "ChatGPT",
    routeKind: "bridged",
    source:
      codexModels.length > 0
        ? "catálogo do Codex CLI (models_cache.json)"
        : "indisponível — cache do Codex não encontrado",
    models: codexModels,
  });
  return entries;
}
