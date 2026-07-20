import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Database } from "../db/connection";

export type MemorySource = {
  id: string;
  rootPath: string;
  scopePath: string;
  accessMode: "read" | "excluded";
  createdAt: string;
  updatedAt: string;
};

type MemorySourceRow = {
  id: string;
  root_path: string;
  scope_path: string;
  access_mode: "read" | "excluded";
  created_at: string;
  updated_at: string;
};

export function configureSources(
  db: Database,
  paths: string[],
  now: string,
): MemorySource[] {
  const canonicalPaths = uniqueCanonicalDirectories(paths);
  const existingPaths = (
    db.prepare("SELECT scope_path FROM memory_sources").all() as Array<{
      scope_path: string;
    }>
  ).map((row) => row.scope_path);
  for (const candidate of canonicalPaths) {
    if (
      existingPaths.some(
        (existing) =>
          existing !== candidate &&
          (overlaps(existing, candidate) || overlaps(candidate, existing)),
      )
    ) {
      throw new Error("Fontes de memória não podem se sobrepõem");
    }
  }
  return canonicalPaths.map((scopePath) => {
    const existing = db
      .prepare(
        `SELECT id, root_path, scope_path, access_mode, created_at, updated_at
         FROM memory_sources WHERE root_path = ? AND scope_path = ?`,
      )
      .get(scopePath, scopePath) as MemorySourceRow | undefined;
    if (existing) return toSource(existing);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO memory_sources
       (id, root_path, scope_path, access_mode, created_at, updated_at)
       VALUES (?, ?, ?, 'read', ?, ?)`,
    ).run(id, scopePath, scopePath, now, now);
    return {
      id,
      rootPath: scopePath,
      scopePath,
      accessMode: "read",
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function getSource(db: Database, sourceId: string): MemorySource {
  const row = db
    .prepare(
      `SELECT id, root_path, scope_path, access_mode, created_at, updated_at
       FROM memory_sources WHERE id = ?`,
    )
    .get(sourceId) as MemorySourceRow | undefined;
  if (!row) throw new Error(`Fonte de memória ${sourceId} não encontrada`);
  return toSource(row);
}

export function listSources(db: Database): MemorySource[] {
  return (
    db
      .prepare(
        `SELECT id, root_path, scope_path, access_mode, created_at, updated_at
         FROM memory_sources ORDER BY created_at, id`,
      )
      .all() as MemorySourceRow[]
  ).map(toSource);
}

export function assertSourceIntact(source: MemorySource): void {
  const stat = lstatSync(source.scopePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("A fonte de memória foi alterada ou é um symlink");
  }
  if (realpathSync(source.scopePath) !== source.rootPath) {
    throw new Error(
      "A fonte de memória foi alterada fora do escopo autorizado",
    );
  }
}

function uniqueCanonicalDirectories(paths: string[]): string[] {
  if (paths.length === 0) throw new Error("Selecione ao menos uma pasta");
  const canonical = paths.map((candidate) => {
    if (!path.isAbsolute(candidate)) {
      throw new Error("A fonte de memória deve usar um caminho absoluto");
    }
    const resolved = realpathSync(candidate);
    if (!statSync(resolved).isDirectory()) {
      throw new Error("A fonte de memória deve ser uma pasta existente");
    }
    if (resolved === path.parse(resolved).root) {
      throw new Error("A raiz do filesystem não pode ser uma fonte de memória");
    }
    return resolved;
  });
  if (new Set(canonical).size !== canonical.length) {
    throw new Error("Uma pasta de memória foi selecionada mais de uma vez");
  }
  for (let index = 0; index < canonical.length; index += 1) {
    if (
      canonical.some(
        (candidate, other) =>
          other !== index && overlaps(canonical[index]!, candidate),
      )
    ) {
      throw new Error("Fontes de memória não podem se sobrepõem");
    }
  }
  return canonical;
}

function overlaps(left: string, right: string): boolean {
  const relative = path.relative(left, right);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function toSource(row: MemorySourceRow): MemorySource {
  return {
    id: row.id,
    rootPath: row.root_path,
    scopePath: row.scope_path,
    accessMode: row.access_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
