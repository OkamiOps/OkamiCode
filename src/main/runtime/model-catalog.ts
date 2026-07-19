import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
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

interface ClaudeFamilyVersions {
  fable?: string;
  opus?: string;
  sonnet?: string;
  haiku?: string;
}

let claudeScanCache: { key: string; versions: ClaudeFamilyVersions } | null =
  null;

function familyVersionLabel(suffix: string): string {
  return suffix.replace(/-/gu, ".");
}

// Scans the installed Claude Code binary for current model ids so the picker
// mirrors what this CLI version actually ships (updates with the CLI).
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

function scanClaudeBinaryVersions(): ClaudeFamilyVersions {
  try {
    const binary = locateClaudeBinary();
    if (!binary) return {};
    const cacheKey = `${binary}:${statSync(binary).mtimeMs}`;
    if (claudeScanCache?.key === cacheKey) return claudeScanCache.versions;
    const contents = readFileSync(binary).toString("latin1");
    const versions: ClaudeFamilyVersions = {};
    for (const family of ["fable", "opus", "sonnet", "haiku"] as const) {
      const pattern = new RegExp(`claude-${family}-(\\d+(?:-\\d+)?)\\b`, "gu");
      let best: [number, number] | null = null;
      let bestSuffix: string | undefined;
      for (const match of contents.matchAll(pattern)) {
        const [major, minor = 0] = match[1].split("-").map(Number);
        // Segments above 99 are date-stamped snapshot ids, not versions.
        if (major > 99 || minor > 99) continue;
        if (
          !best ||
          major > best[0] ||
          (major === best[0] && minor > best[1])
        ) {
          best = [major, minor];
          bestSuffix = match[1];
        }
      }
      if (bestSuffix) versions[family] = bestSuffix;
    }
    claudeScanCache = { key: cacheKey, versions };
    console.log("[okami] claude model scan", versions);
    return versions;
  } catch (error) {
    console.error("[okami] claude model scan failed", error);
    return {};
  }
}

function claudeModels(): CatalogModel[] {
  const versions = scanClaudeBinaryVersions();
  const models: CatalogModel[] = [];
  if (versions.fable) {
    models.push({
      id: `claude-fable-${versions.fable}`,
      label: `Fable ${familyVersionLabel(versions.fable)}`,
      description: "Classe Mythos — modelo mais avançado",
    });
  }
  models.push(
    {
      id: "opus",
      label: versions.opus
        ? `Opus ${familyVersionLabel(versions.opus)}`
        : "Opus",
      description: "Melhor para tarefas complexas do dia a dia",
    },
    {
      id: "sonnet",
      label: versions.sonnet
        ? `Sonnet ${familyVersionLabel(versions.sonnet)}`
        : "Sonnet",
      description: "Eficiente para tarefas rotineiras",
    },
    {
      id: "haiku",
      label: versions.haiku
        ? `Haiku ${familyVersionLabel(versions.haiku)}`
        : "Haiku",
      description: "Mais rápido, para respostas curtas",
    },
    {
      id: "opusplan",
      label: "Opus Plan",
      description: "Opus para planejar, Sonnet para executar",
    },
  );
  return models;
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
      source: "catálogo do Claude Code instalado",
      models: claudeModels(),
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
