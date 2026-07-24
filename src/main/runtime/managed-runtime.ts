import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { materializeVerifiedArtifactSync } from "./managed-artifact.mjs";

interface ManagedRuntimeOptions {
  runtimeDirectory: string;
  resourcesDirectory?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  resolvePackageJson?: (packageName: string) => string;
}

export interface ManagedRuntimeCommands {
  codex: string;
  grok: string;
  cursor: string;
  agy: string;
  opencode: string;
}

const CODEX_TRIPLES: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "linux-x64": "x86_64-unknown-linux-musl",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
};

export function resolveManagedRuntimeCommands(
  options: ManagedRuntimeOptions,
): ManagedRuntimeCommands {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = `${platform}-${arch}`;
  const triple = CODEX_TRIPLES[target];
  if (!triple) throw new Error(`Unsupported managed runtime target ${target}`);
  const resolvePackageJson =
    options.resolvePackageJson ?? defaultPackageResolver();
  const resourcesDirectory =
    options.resourcesDirectory ?? process.resourcesPath;
  const executableName = platform === "win32" ? "codex.exe" : "codex";
  const codexPackage = path.dirname(
    resolvePackageJson(`@openai/codex-${target}`),
  );
  const codex = unpackedExecutablePath(
    path.join(codexPackage, "vendor", triple, "bin", executableName),
  );
  if (!existsSync(codex)) {
    throw new Error(`Managed Codex binary is missing for ${target}`);
  }

  const grokPackage = path.dirname(
    resolvePackageJson(`@xai-official/grok-${target}`),
  );
  const grok = materializeGrok({
    sourceDirectory: grokPackage,
    runtimeDirectory: options.runtimeDirectory,
    targetDirectory: path.join(options.runtimeDirectory, "grok", target),
    executableName: platform === "win32" ? "grok.exe" : "grok",
  });
  const managedTargetDirectory = path.join(
    resourcesDirectory,
    "managed-runtimes",
    target,
  );
  const cursor = requiredManagedExecutable(
    path.join(
      managedTargetDirectory,
      "cursor",
      platform === "win32" ? "cursor-agent.exe" : "cursor-agent",
    ),
    "Cursor",
    target,
  );
  const agy = requiredManagedExecutable(
    path.join(
      managedTargetDirectory,
      "agy",
      platform === "win32" ? "agy.exe" : "agy",
    ),
    "Antigravity",
    target,
  );
  const opencodePackage = path.dirname(
    resolvePackageJson(`opencode-${target}`),
  );
  const opencode = requiredManagedExecutable(
    unpackedExecutablePath(
      path.join(
        opencodePackage,
        "bin",
        platform === "win32" ? "opencode.exe" : "opencode",
      ),
    ),
    "OpenCode",
    target,
  );
  return { codex, grok, cursor, agy, opencode };
}

function defaultPackageResolver(): (packageName: string) => string {
  const require = createRequire(import.meta.url);
  const codexRequire = createRequire(
    require.resolve("@openai/codex/package.json"),
  );
  const grokRequire = createRequire(
    require.resolve("@xai-official/grok/package.json"),
  );
  const opencodeRequire = createRequire(
    require.resolve("opencode-ai/package.json"),
  );
  return (packageName) => {
    if (packageName.startsWith("@openai/"))
      return codexRequire.resolve(`${packageName}/package.json`);
    if (packageName.startsWith("@xai-official/"))
      return grokRequire.resolve(`${packageName}/package.json`);
    return opencodeRequire.resolve(`${packageName}/package.json`);
  };
}

function requiredManagedExecutable(
  executable: string,
  runtime: string,
  target: string,
): string {
  if (!path.isAbsolute(executable) || !existsSync(executable)) {
    throw new Error(`Managed ${runtime} binary is missing for ${target}`);
  }
  return executable;
}

function materializeGrok(options: {
  sourceDirectory: string;
  runtimeDirectory: string;
  targetDirectory: string;
  executableName: string;
}): string {
  const raw = unpackedExecutablePath(
    path.join(options.sourceDirectory, "bin", options.executableName),
  );
  const compressed = `${raw}.br`;
  const payload = existsSync(raw)
    ? readFileSync(raw)
    : brotliDecompressSync(readFileSync(compressed));
  return materializeVerifiedArtifactSync({
    runtimeDirectory: options.runtimeDirectory,
    targetDirectory: options.targetDirectory,
    executableName: options.executableName,
    label: "Grok",
    payload,
  });
}

function unpackedExecutablePath(candidate: string): string {
  return candidate.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
}
