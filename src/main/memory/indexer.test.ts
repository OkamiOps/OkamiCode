import {
  mkdirSync,
  mkdtempSync,
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
      "---\nsecret: unsafe\nlabel: safe\n---\n# Inside\npassword: unsafe\nSafe text",
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
    expect(row.plain_text).not.toMatch(/password|unsafe|private key/iu);
    expect(row.frontmatter_json).not.toMatch(/secret|unsafe/iu);
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
});
