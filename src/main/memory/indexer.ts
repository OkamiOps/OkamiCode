import type { FSWatcher } from "chokidar";
import type { Database } from "../db/connection";
import {
  configureSources,
  getSource,
  listSources,
  type MemorySource,
} from "./config";
import { scanSource } from "./scanner";
import { searchMemory, type MemorySearchResult } from "./search";
import { watchSource } from "./watcher";

export class MemoryService {
  private readonly watchers = new Map<string, FSWatcher>();

  constructor(
    private readonly dependencies: {
      db: Database;
      clock?: () => Date;
      watch?: boolean;
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

  fullSync(sourceId: string): { indexed: number; removed: number } {
    const source = getSource(this.dependencies.db, sourceId);
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
            sourceId: source.id,
            path: document.path,
            title: document.title,
            frontmatterJson: JSON.stringify(document.frontmatter),
            plainText: document.plainText,
            contentHash: document.contentHash,
            modifiedAt: document.modifiedAt,
            indexedAt,
          });
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
    let usedBytes = 0;
    const blocks = ids.map((id) => {
      const row = ordered.get(id)!;
      const block = `--- OKAMI MEMORY: ${row.path} ---\n${row.plain_text}\n--- END OKAMI MEMORY ---`;
      usedBytes += Buffer.byteLength(block);
      if (usedBytes > maxBytes)
        throw new Error("O contexto de memória excede 64 KiB");
      return block;
    });
    return blocks.join("\n\n");
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.watchers.values()].map((watcher) => watcher.close()),
    );
    this.watchers.clear();
  }

  private startWatching(source: MemorySource): void {
    if (this.watchers.has(source.id)) return;
    this.watchers.set(
      source.id,
      watchSource(source, () => this.fullSync(source.id)),
    );
  }
}
