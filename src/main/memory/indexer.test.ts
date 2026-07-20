import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../db/test-support";
import { MemoryService } from "./indexer";

const fixtureRoot = path.resolve("tests/fixtures/obsidian");

function createMemoryHarness() {
  const fx = createTestDatabase();
  const service = new MemoryService({ db: fx.db, watch: false });
  return { fx, service };
}

describe("MemoryService", () => {
  it("indexes only explicitly allowed markdown and returns provenance", () => {
    const { service } = createMemoryHarness();
    const [source] = service.configure([
      path.join(fixtureRoot, "Claude Code", "Projetos"),
    ]);

    service.fullSync(source.id);

    const results = service.search("subscription gateway");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Subscription Gateway",
      sourceId: source.id,
    });
    expect(results[0]?.path).toMatch(/Claude Code\/Projetos\/okami\.md$/u);
    expect(results[0]?.citation).toContain("okami.md");
    expect(service.search("private key fixture")).toHaveLength(0);
  });

  it("never escapes a configured source and redacts sensitive lines before persistence", () => {
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const inside = path.join(root, "inside.md");
    const outside = path.join(tmpdir(), "outside-memory-note.md");
    writeFileSync(
      inside,
      [
        "---",
        "credentials:",
        "  username: unsafe-user",
        "  password: unsafe-password",
        "private_key: unsafe",
        "label: safe",
        "---",
        "# Inside",
        "password: unsafe",
        "-----BEGIN PRIVATE KEY-----",
        "c2VjcmV0LWtleS1ib2R5",
        "-----END PRIVATE KEY-----",
        "Safe text",
      ].join("\n"),
    );
    writeFileSync(outside, "# Outside\nprivate key fixture");
    symlinkSync(outside, path.join(root, "escaped.md"));
    const { fx, service } = createMemoryHarness();
    const [source] = service.configure([root]);

    service.fullSync(source.id);

    const row = fx.db
      .prepare(
        "SELECT plain_text, frontmatter_json FROM memory_documents WHERE source_id = ?",
      )
      .get(source.id) as { plain_text: string; frontmatter_json: string };
    expect(row.plain_text).toContain("Safe text");
    expect(row.plain_text).not.toMatch(
      /password|unsafe|private[_ -]?key|c2VjcmV0LWtleS1ib2R5/iu,
    );
    expect(row.frontmatter_json).not.toMatch(
      /credentials|secret|unsafe|private[_ -]?key/iu,
    );
    expect(service.search("private_key")).toHaveLength(0);
    expect(service.search("outside")).toHaveLength(0);
  });

  it("is idempotent and removes documents deleted from one source only", () => {
    const { fx, service } = createMemoryHarness();
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const one = path.join(root, "one.md");
    const two = path.join(root, "two.md");
    writeFileSync(one, "# One\nfirst");
    writeFileSync(two, "# Two\nsecond");
    const [source] = service.configure([root]);

    service.fullSync(source.id);
    service.fullSync(source.id);
    expect(
      fx.db.prepare("SELECT count(*) AS count FROM memory_documents").get(),
    ).toEqual({ count: 2 });
    writeFileSync(one, "# One\nchanged");
    unlinkSync(two);
    service.fullSync(source.id);
    expect(service.search("second")).toHaveLength(0);
    expect(service.search("changed")).toHaveLength(1);
  });

  it("rejects overlapping canonical sources so a document has one owner", () => {
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const nested = path.join(root, "nested");
    mkdirSync(nested);
    const { service } = createMemoryHarness();

    expect(() => service.configure([root, nested])).toThrow(/sobrepõem/iu);
  });

  it("rejects overlapping persisted sources in either configuration order", () => {
    for (const nestedFirst of [true, false]) {
      const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
      const nested = path.join(root, "nested");
      mkdirSync(nested);
      const { service } = createMemoryHarness();
      service.configure([nestedFirst ? nested : root]);

      expect(() => service.configure([nestedFirst ? root : nested])).toThrow(
        /sobrepõem/iu,
      );
    }
  });

  it("rejects relative source paths", () => {
    const { service } = createMemoryHarness();
    expect(() => service.configure(["."])).toThrow(/absolut/iu);
  });

  it("rejects a source replaced by a symlink after configuration", () => {
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const outside = mkdtempSync(path.join(tmpdir(), "okami-outside-"));
    writeFileSync(path.join(root, "inside.md"), "# Inside\ntrusted");
    writeFileSync(path.join(outside, "outside.md"), "# Outside\nprivate_key");
    const { service } = createMemoryHarness();
    const [source] = service.configure([root]);
    renameSync(root, `${root}-moved`);
    symlinkSync(outside, root);

    expect(() => service.fullSync(source.id)).toThrow(/symlink|alterada/iu);
  });

  it("rehydrates one watcher per persisted source on start", async () => {
    const fx = createTestDatabase();
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const watched: string[] = [];
    const watcher = { close: async () => undefined };
    const service = new MemoryService({
      db: fx.db,
      watchFactory: (source) => {
        watched.push(source.id);
        return watcher as never;
      },
    });
    const [source] = service.configure([root]);

    await service.close();
    watched.length = 0;
    service.start();
    expect(watched).toEqual([source.id]);
    await service.close();
  });

  it("isolates an unavailable persisted source during watcher rehydration", async () => {
    const fx = createTestDatabase();
    const available = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const unavailable = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const watched: string[] = [];
    const service = new MemoryService({
      db: fx.db,
      watchFactory: (source) => {
        watched.push(source.id);
        return { close: async () => undefined };
      },
    });
    const [availableSource, unavailableSource] = service.configure([
      available,
      unavailable,
    ]);
    await service.close();
    watched.length = 0;
    renameSync(unavailable, `${unavailable}-moved`);

    const report = service.start();

    expect(watched).toEqual([availableSource.id]);
    expect(report).toEqual({
      started: 1,
      failed: [expect.objectContaining({ sourceId: unavailableSource.id })],
    });
    await service.close();
  });

  it("reindexes only the file reported by the watcher", async () => {
    const fx = createTestDatabase();
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    const first = path.join(root, "first.md");
    const second = path.join(root, "second.md");
    writeFileSync(first, "# First\noriginal first");
    writeFileSync(second, "# Second\noriginal second");
    let notify:
      | ((event: { kind: "upsert" | "remove"; path: string }) => void)
      | undefined;
    const service = new MemoryService({
      db: fx.db,
      watchFactory: (_source, reindex) => {
        notify = reindex as typeof notify;
        return { close: async () => undefined };
      },
    });
    const [source] = service.configure([root]);
    const watchedFirst = path.join(source.scopePath, "first.md");
    const watchedSecond = path.join(source.scopePath, "second.md");

    writeFileSync(first, "# First\nchanged first");
    writeFileSync(second, "# Second\nchanged second");
    notify?.({ kind: "upsert", path: watchedFirst });

    expect(
      fx.db
        .prepare("SELECT plain_text FROM memory_documents WHERE path = ?")
        .get(watchedFirst),
    ).toEqual({ plain_text: "First\nchanged first" });
    expect(service.search("changed first")).toHaveLength(1);
    expect(service.search("changed second")).toHaveLength(0);
    expect(service.search("original second")).toHaveLength(1);

    unlinkSync(second);
    notify?.({ kind: "remove", path: watchedSecond });
    expect(service.search("original second")).toHaveLength(0);
    await service.close();
  });

  it("delimits authorized context and rejects missing ids or oversized content", () => {
    const { fx, service } = createMemoryHarness();
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    writeFileSync(path.join(root, "note.md"), "# Note\ntrusted context");
    const [source] = service.configure([root]);
    const row = fx.db
      .prepare("SELECT id FROM memory_documents WHERE source_id = ?")
      .get(source.id) as { id: number };

    expect(service.resolveContextRefs([`memory:${row.id}`])).toContain(
      "--- OKAMI MEMORY:",
    );
    expect(() => service.resolveContextRefs(["memory:999999"])).toThrow(
      /não autorizada/iu,
    );
    expect(() => service.resolveContextRefs([`memory:${row.id}`], 8)).toThrow(
      /64 KiB/iu,
    );
  });

  it("counts separators inside the total memory context limit", () => {
    const { fx, service } = createMemoryHarness();
    const root = mkdtempSync(path.join(tmpdir(), "okami-memory-"));
    writeFileSync(path.join(root, "one.md"), "# One\nfirst context");
    writeFileSync(path.join(root, "two.md"), "# Two\nsecond context");
    const [source] = service.configure([root]);
    const refs = (
      fx.db
        .prepare(
          "SELECT id FROM memory_documents WHERE source_id = ? ORDER BY path",
        )
        .all(source.id) as Array<{ id: number }>
    ).map(({ id }) => `memory:${id}`);
    const complete = service.resolveContextRefs(refs);

    expect(() =>
      service.resolveContextRefs(refs, Buffer.byteLength(complete) - 1),
    ).toThrow(/64 KiB/iu);
  });
});
