import type { Database } from "../db/connection";

export type MemorySearchResult = {
  id: number;
  sourceId: string;
  title: string;
  path: string;
  excerpt: string;
  heading: string | null;
  citation: string;
  score: number;
};

type SearchRow = {
  id: number;
  source_id: string;
  title: string;
  path: string;
  plain_text: string;
  modified_at: string;
  rank: number;
};

export function searchMemory(
  db: Database,
  query: string,
  limit: number,
): MemorySearchResult[] {
  const sanitized = toFtsQuery(query);
  if (!sanitized) return [];
  const rows = db
    .prepare(
      `SELECT d.id, d.source_id, d.title, d.path, d.plain_text, d.modified_at,
              bm25(memory_fts) AS rank
       FROM memory_fts
       JOIN memory_documents d ON d.id = memory_fts.rowid
       JOIN memory_sources s ON s.id = d.source_id AND s.access_mode = 'read'
       WHERE memory_fts MATCH ?
       ORDER BY rank ASC, d.modified_at DESC, d.path ASC
       LIMIT ?`,
    )
    .all(sanitized, limit) as SearchRow[];
  return rows.map((row) => {
    const heading = firstHeading(row.plain_text);
    return {
      id: row.id,
      sourceId: row.source_id,
      title: row.title,
      path: row.path,
      excerpt: excerpt(row.plain_text, query),
      heading,
      citation: `${row.path}${heading ? `#${heading}` : ""}`,
      score: Number((-row.rank).toFixed(6)),
    };
  });
}

export function toFtsQuery(query: string): string {
  return (
    query
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" AND ") ?? ""
  );
}

function firstHeading(plainText: string): string | null {
  return plainText.split("\n").find(Boolean)?.trim() ?? null;
}

function excerpt(plainText: string, query: string): string {
  const term = query.match(/[\p{L}\p{N}_-]+/u)?.[0] ?? "";
  const index = term
    ? plainText.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
    : 0;
  const start = Math.max(0, index - 80);
  return plainText
    .slice(start, start + 240)
    .replace(/\s+/gu, " ")
    .trim();
}
