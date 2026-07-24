import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";

interface ManagedRuntimeOptions {
  runtimeDirectory: string;
  platform?: NodeJS.Platform;
  arch?: string;
  resolvePackageJson?: (packageName: string) => string;
}

export interface ManagedRuntimeCommands {
  codex: string;
  grok: string;
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
    targetDirectory: path.join(options.runtimeDirectory, "grok", target),
    executableName: platform === "win32" ? "grok.exe" : "grok",
  });
  return { codex, grok };
}

function defaultPackageResolver(): (packageName: string) => string {
  const require = createRequire(import.meta.url);
  const codexRequire = createRequire(
    require.resolve("@openai/codex/package.json"),
  );
  const grokRequire = createRequire(
    require.resolve("@xai-official/grok/package.json"),
  );
  return (packageName) =>
    packageName.startsWith("@openai/")
      ? codexRequire.resolve(`${packageName}/package.json`)
      : grokRequire.resolve(`${packageName}/package.json`);
}

function materializeGrok(options: {
  sourceDirectory: string;
  targetDirectory: string;
  executableName: string;
}): string {
  mkdirSync(options.targetDirectory, { recursive: true });
  const target = path.join(options.targetDirectory, options.executableName);
  if (existsSync(target)) return target;
  const raw = unpackedExecutablePath(
    path.join(options.sourceDirectory, "bin", options.executableName),
  );
  const compressed = `${raw}.br`;
  const payload = existsSync(raw)
    ? readFileSync(raw)
    : brotliDecompressSync(readFileSync(compressed));
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, payload, { mode: 0o755 });
    if (process.platform !== "win32") chmodSync(temporary, 0o755);
    renameSync(temporary, target);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Atomic rename already consumed the temporary file.
    }
  }
  return target;
}

function unpackedExecutablePath(candidate: string): string {
  return candidate.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`,
  );
}
