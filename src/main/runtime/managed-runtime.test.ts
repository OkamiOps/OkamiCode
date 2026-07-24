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
  const opencodePackage = path.join(root, "opencode-platform");
  const resourcesDirectory = path.join(root, "resources");
  const codexBinary = path.join(
    codexPackage,
    "vendor",
    "aarch64-apple-darwin",
    "bin",
    "codex",
  );
  const grokCompressed = path.join(grokPackage, "bin", "grok.br");
  const opencodeBinary = path.join(opencodePackage, "bin", "opencode");
  const cursorBinary = path.join(
    resourcesDirectory,
    "managed-runtimes",
    "darwin-arm64",
    "cursor",
    "cursor-agent",
  );
  const agyBinary = path.join(
    resourcesDirectory,
    "managed-runtimes",
    "darwin-arm64",
    "agy",
    "agy",
  );
  mkdirSync(path.dirname(codexBinary), { recursive: true });
  mkdirSync(path.dirname(grokCompressed), { recursive: true });
  mkdirSync(path.dirname(opencodeBinary), { recursive: true });
  mkdirSync(path.dirname(cursorBinary), { recursive: true });
  mkdirSync(path.dirname(agyBinary), { recursive: true });
  writeFileSync(codexBinary, "official-codex");
  writeFileSync(
    grokCompressed,
    brotliCompressSync(Buffer.from("official-grok")),
  );
  writeFileSync(opencodeBinary, "official-opencode");
  writeFileSync(cursorBinary, "official-cursor");
  writeFileSync(agyBinary, "official-antigravity");

  const commands = resolveManagedRuntimeCommands({
    runtimeDirectory: path.join(root, "okami"),
    resourcesDirectory,
    platform: "darwin",
    arch: "arm64",
    resolvePackageJson: (name) => {
      if (name === "@openai/codex-darwin-arm64")
        return path.join(codexPackage, "package.json");
      if (name === "@xai-official/grok-darwin-arm64")
        return path.join(grokPackage, "package.json");
      if (name === "opencode-darwin-arm64")
        return path.join(opencodePackage, "package.json");
      throw new Error(`Unexpected package ${name}`);
    },
  });

  expect(commands.codex).toBe(codexBinary);
  expect(readFileSync(commands.grok, "utf8")).toBe("official-grok");
  expect(commands.grok).toContain(`${path.sep}okami${path.sep}grok${path.sep}`);
  expect(commands.cursor).toBe(cursorBinary);
  expect(commands.agy).toBe(agyBinary);
  expect(commands.opencode).toBe(opencodeBinary);
  expect(Object.values(commands).every(path.isAbsolute)).toBe(true);
});

it("fails closed when a packaged managed runtime is missing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "okami-managed-runtime-"));
  const codexPackage = path.join(root, "codex-platform");
  const grokPackage = path.join(root, "grok-platform");
  const opencodePackage = path.join(root, "opencode-platform");
  const codexBinary = path.join(
    codexPackage,
    "vendor",
    "aarch64-apple-darwin",
    "bin",
    "codex",
  );
  mkdirSync(path.dirname(codexBinary), { recursive: true });
  mkdirSync(path.join(grokPackage, "bin"), { recursive: true });
  mkdirSync(path.join(opencodePackage, "bin"), { recursive: true });
  writeFileSync(codexBinary, "official-codex");
  writeFileSync(path.join(grokPackage, "bin", "grok"), "official-grok");
  writeFileSync(
    path.join(opencodePackage, "bin", "opencode"),
    "official-opencode",
  );

  expect(() =>
    resolveManagedRuntimeCommands({
      runtimeDirectory: path.join(root, "okami"),
      resourcesDirectory: path.join(root, "resources"),
      platform: "darwin",
      arch: "arm64",
      resolvePackageJson: (name) => {
        if (name === "@openai/codex-darwin-arm64")
          return path.join(codexPackage, "package.json");
        if (name === "@xai-official/grok-darwin-arm64")
          return path.join(grokPackage, "package.json");
        if (name === "opencode-darwin-arm64")
          return path.join(opencodePackage, "package.json");
        throw new Error(`Unexpected package ${name}`);
      },
    }),
  ).toThrow("Managed Cursor binary is missing for darwin-arm64");
});
