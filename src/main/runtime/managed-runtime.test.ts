import { brotliCompressSync } from "node:zlib";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  resolveManagedRuntimeCommands,
  resolveManagedRuntimeResourcesDirectory,
} from "./managed-runtime";

it("selects the provisioned workspace cache in development and packaged resources in production", () => {
  expect(
    resolveManagedRuntimeResourcesDirectory({
      isPackaged: false,
      appPath: "/workspace/OkamiCode",
      resourcesPath: "/Applications/OkamiCode.app/Contents/Resources",
    }),
  ).toBe(path.resolve("/workspace/OkamiCode", ".cache"));
  expect(
    resolveManagedRuntimeResourcesDirectory({
      isPackaged: true,
      appPath: "/workspace/OkamiCode",
      resourcesPath: "/Applications/OkamiCode.app/Contents/Resources",
    }),
  ).toBe("/Applications/OkamiCode.app/Contents/Resources");
});

it("resolves the real provisioner layout during development bootstrap", () => {
  const fixture = createCompleteManagedRuntimeFixture(".cache");
  const resourcesDirectory = resolveManagedRuntimeResourcesDirectory({
    isPackaged: false,
    appPath: fixture.root,
    resourcesPath: path.join(fixture.root, "packaged-resources"),
  });

  const commands = resolveManagedRuntimeCommands({
    ...fixture.options,
    resourcesDirectory,
  });

  expect(commands.cursor).toBe(
    path.join(
      fixture.root,
      ".cache",
      "managed-runtimes",
      "darwin-arm64",
      "cursor",
      "cursor-agent",
    ),
  );
  expect(commands.agy).toBe(
    path.join(
      fixture.root,
      ".cache",
      "managed-runtimes",
      "darwin-arm64",
      "agy",
      "agy",
    ),
  );
});

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

it("rejects a pre-existing Grok symlink that escapes Okami runtime storage", () => {
  const fixture = createCompleteManagedRuntimeFixture();
  const escapedGrok = path.join(fixture.root, "global", "grok");
  mkdirSync(path.dirname(escapedGrok), { recursive: true });
  writeFileSync(escapedGrok, "official-grok");
  mkdirSync(path.dirname(fixture.grokTarget), { recursive: true });
  symlinkSync(escapedGrok, fixture.grokTarget);

  expect(() => resolveManagedRuntimeCommands(fixture.options)).toThrow(
    /Grok.*symlink|symlink.*Grok/iu,
  );
});

it("rejects an Okami runtime directory that is itself an escaping symlink", () => {
  const fixture = createCompleteManagedRuntimeFixture();
  const escapedRuntimeDirectory = path.join(fixture.root, "global-runtime");
  mkdirSync(escapedRuntimeDirectory, { recursive: true });
  symlinkSync(escapedRuntimeDirectory, fixture.options.runtimeDirectory, "dir");

  expect(() => resolveManagedRuntimeCommands(fixture.options)).toThrow(
    /runtime directory must not be a symlink/iu,
  );
});

it("rejects a pre-existing Grok executable that diverges from the packaged payload", () => {
  const fixture = createCompleteManagedRuntimeFixture();
  mkdirSync(path.dirname(fixture.grokTarget), { recursive: true });
  writeFileSync(fixture.grokTarget, "tampered-grok");

  expect(() => resolveManagedRuntimeCommands(fixture.options)).toThrow(
    /Grok.*does not match the packaged artifact/iu,
  );
});

function createCompleteManagedRuntimeFixture(resourcesName = "resources"): {
  root: string;
  grokTarget: string;
  options: Parameters<typeof resolveManagedRuntimeCommands>[0];
} {
  const root = mkdtempSync(path.join(tmpdir(), "okami-managed-runtime-"));
  const codexPackage = path.join(root, "codex-platform");
  const grokPackage = path.join(root, "grok-platform");
  const opencodePackage = path.join(root, "opencode-platform");
  const resourcesDirectory = path.join(root, resourcesName);
  const runtimeDirectory = path.join(root, "okami");
  const files = [
    path.join(codexPackage, "vendor", "aarch64-apple-darwin", "bin", "codex"),
    path.join(opencodePackage, "bin", "opencode"),
    path.join(
      resourcesDirectory,
      "managed-runtimes",
      "darwin-arm64",
      "cursor",
      "cursor-agent",
    ),
    path.join(
      resourcesDirectory,
      "managed-runtimes",
      "darwin-arm64",
      "agy",
      "agy",
    ),
  ];
  for (const file of files) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `official-${path.basename(file)}`);
  }
  const grokCompressed = path.join(grokPackage, "bin", "grok.br");
  mkdirSync(path.dirname(grokCompressed), { recursive: true });
  writeFileSync(
    grokCompressed,
    brotliCompressSync(Buffer.from("official-grok")),
  );
  const options = {
    runtimeDirectory,
    resourcesDirectory,
    platform: "darwin" as const,
    arch: "arm64",
    resolvePackageJson: (name: string) => {
      if (name === "@openai/codex-darwin-arm64")
        return path.join(codexPackage, "package.json");
      if (name === "@xai-official/grok-darwin-arm64")
        return path.join(grokPackage, "package.json");
      if (name === "opencode-darwin-arm64")
        return path.join(opencodePackage, "package.json");
      throw new Error(`Unexpected package ${name}`);
    },
  };
  return {
    root,
    grokTarget: path.join(runtimeDirectory, "grok", "darwin-arm64", "grok"),
    options,
  };
}
