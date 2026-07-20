import path from "node:path";
import type { Database } from "../db/connection";
import {
  assertSourceIntact,
  configureSources,
  getSource,
  listSources,
  type MemorySource,
} from "./config";
import { scanFile, scanSource, type ScannedDocument } from "./scanner";
import { searchMemory, type MemorySearchResult } from "./search";
import {
  watchSource,
  type MemoryWatcher,
  type MemoryWatchEvent,
} from "./watcher";

export type MemoryStartReport = {
  started: number;
  failed: Array<{ sourceId: string; message: string }>;
};

export class MemoryService {
  private readonly watchers = new Map<string, MemoryWatcher>();

  constructor(
    private readonly dependencies: {
      db: Database;
      clock?: () => Date;
      watch?: boolean;
      watchFactory?: (
        source: MemorySource,
        onChange: (event: MemoryWatchEvent) => void,
      ) => MemoryWatcher;
    },
  ) {}

  configure(paths: string[]): MemorySource[] {
    const sources = configureSources(
      this.dependencies.db,
      paths,
      (this.dependencies.clock ?? (() => new Date()))().toISOString(),
    );
    for (const source of sources) {
      this.fullSync(source.id);
      if (this.dependencies.watch !== false) this.startWatching(source);
    }
    return sources;
  }

  listSources(): MemorySource[] {
    return listSources(this.dependencies.db);
  }

  start(): MemoryStartReport {
    const report: MemoryStartReport = { started: 0, failed: [] };
    if (this.dependencies.watch === false) return report;
    for (const source of this.listSources()) {
      try {
        this.startWatching(source);
        report.started += 1;
      } catch (error) {
        report.failed.push({
          sourceId: source.id,
          message: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }
    }
    return report;
  }

  fullSync(sourceId: string): { indexed: number; removed: number } {
    const source = getSource(this.dependencies.db, sourceId);
    assertSourceIntact(source);
    const scanned = scanSource(source);
    const existing = this.dependencies.db
      .prepare(
        "SELECT id, path, content_hash, modified_at FROM memory_documents WHERE source_id = ?",
      )
      .all(source.id) as Array<{
      id: number;
      path: string;
      content_hash: string;
      modified_at: string;
    }>;
    const byPath = new Map(existing.map((row) => [row.path, row]));
    const seen = new Set<string>();
    const indexedAt = (
      this.dependencies.clock ?? (() => new Date())
    )().toISOString();
    let indexed = 0;
    const sync = this.dependencies.db.transaction(() => {
      for (const document of scanned) {
        seen.add(document.path);
        const previous = byPath.get(document.path);
        if (
          previous?.content_hash === document.contentHash &&
          previous.modified_at === document.modifiedAt
        )
          continue;
        this.upsertDocument(source.id, document, indexedAt);
        indexed += 1;
      }
      const stale = existing.filter((document) => !seen.has(document.path));
      for (const document of stale) {
        this.dependencies.db
          .prepare("DELETE FROM memory_documents WHERE id = ?")
          .run(document.id);
      }
    });
    sync();
    return {
      indexed,
      removed: existing.filter((document) => !seen.has(document.path)).length,
    };
  }

  reindex(sourceId: string): { indexed: number; removed: number } {
    return this.fullSync(sourceId);
  }

  search(query: string, limit = 20): MemorySearchResult[] {
    return searchMemory(this.dependencies.db, query, limit);
  }

  resolveContextRefs(refs: string[], maxBytes = 64 * 1024): string {
    const ids = [
      ...new Set(refs.filter((ref) => ref.startsWith("memory:"))),
    ].map((ref) => {
      const id = Number(ref.slice("memory:".length));
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error("Referência de memória inválida");
      return id;
    });
    if (ids.length === 0) return "";
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.dependencies.db
      .prepare(
        `SELECT d.id, d.path, d.plain_text
       FROM memory_documents d JOIN memory_sources s ON s.id = d.source_id
       WHERE s.access_mode = 'read' AND d.id IN (${placeholders})`,
      )
      .all(...ids) as Array<{ id: number; path: string; plain_text: string }>;
    if (rows.length !== ids.length)
      throw new Error("Referência de memória não autorizada");
    const ordered = new Map(rows.map((row) => [row.id, row]));
    const blocks = ids.map((id) => {
      const row = ordered.get(id)!;
      const block = `--- OKAMI MEMORY: ${row.path} ---\n${row.plain_text}\n--- END OKAMI MEMORY ---`;
      return block;
    });
    const context = blocks.join("\n\n");
    if (Buffer.byteLength(context) > maxBytes) {
      throw new Error("O contexto de memória excede 64 KiB");
    }
    return context;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.watchers.values()].map((watcher) => watcher.close()),
    );
    this.watchers.clear();
  }

  private startWatching(source: MemorySource): void {
    if (this.watchers.has(source.id)) return;
    assertSourceIntact(source);
    this.watchers.set(
      source.id,
      (this.dependencies.watchFactory ?? watchSource)(source, (event) =>
        this.applyWatchEvent(source, event),
      ),
    );
  }

  private applyWatchEvent(source: MemorySource, event: MemoryWatchEvent): void {
    assertSourceIntact(source);
    const candidate = path.resolve(event.path);
    if (!isWithin(source.rootPath, candidate)) return;
    if (event.kind === "remove") {
      this.dependencies.db
        .prepare(
          "DELETE FROM memory_documents WHERE source_id = ? AND path = ?",
        )
        .run(source.id, candidate);
      return;
    }
    const document = scanFile(source, candidate);
    if (!document) {
      this.dependencies.db
        .prepare(
          "DELETE FROM memory_documents WHERE source_id = ? AND path = ?",
        )
        .run(source.id, candidate);
      return;
    }
    this.upsertDocument(
      source.id,
      document,
      (this.dependencies.clock ?? (() => new Date()))().toISOString(),
    );
  }

  private upsertDocument(
    sourceId: string,
    document: ScannedDocument,
    indexedAt: string,
  ): void {
    this.dependencies.db
      .prepare(
        `INSERT INTO memory_documents
         (source_id, path, title, frontmatter_json, plain_text, content_hash, modified_at, indexed_at)
         VALUES (@sourceId, @path, @title, @frontmatterJson, @plainText, @contentHash, @modifiedAt, @indexedAt)
         ON CONFLICT(path) DO UPDATE SET
           source_id = excluded.source_id, title = excluded.title,
           frontmatter_json = excluded.frontmatter_json, plain_text = excluded.plain_text,
           content_hash = excluded.content_hash, modified_at = excluded.modified_at,
           indexed_at = excluded.indexed_at`,
      )
      .run({
        sourceId,
        path: document.path,
        title: document.title,
        frontmatterJson: JSON.stringify(document.frontmatter),
        plainText: document.plainText,
        contentHash: document.contentHash,
        modifiedAt: document.modifiedAt,
        indexedAt,
      });
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
