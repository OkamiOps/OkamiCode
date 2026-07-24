import { brotliCompressSync } from "node:zlib";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveManagedRuntimeCommands } from "./managed-runtime";

it("materializes pinned official runtimes inside Okami-owned storage", () => {
  const root = mkdtempSync(path.join(tmpdir(), "okami-managed-runtime-"));
  const codexPackage = path.join(root, "codex-platform");
  const grokPackage = path.join(root, "grok-platform");
  const codexBinary = path.join(
    codexPackage,
    "vendor",
    "aarch64-apple-darwin",
    "bin",
    "codex",
  );
  const grokCompressed = path.join(grokPackage, "bin", "grok.br");
  mkdirSync(path.dirname(codexBinary), { recursive: true });
  mkdirSync(path.dirname(grokCompressed), { recursive: true });
  writeFileSync(codexBinary, "official-codex");
  writeFileSync(
    grokCompressed,
    brotliCompressSync(Buffer.from("official-grok")),
  );

  const commands = resolveManagedRuntimeCommands({
    runtimeDirectory: path.join(root, "okami"),
    platform: "darwin",
    arch: "arm64",
    resolvePackageJson: (name) => {
      if (name === "@openai/codex-darwin-arm64")
        return path.join(codexPackage, "package.json");
      if (name === "@xai-official/grok-darwin-arm64")
        return path.join(grokPackage, "package.json");
      throw new Error(`Unexpected package ${name}`);
    },
  });

  expect(commands.codex).toBe(codexBinary);
  expect(readFileSync(commands.grok, "utf8")).toBe("official-grok");
  expect(commands.grok).toContain(`${path.sep}okami${path.sep}grok${path.sep}`);
});
