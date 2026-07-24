/* global Buffer, process */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { brotliDecompress } from "node:zlib";

const execFileAsync = promisify(execFile);
const brotliDecompressAsync = promisify(brotliDecompress);

export const MINIMAL_PATH = "/usr/bin:/bin";

const EXPECTED_PROVIDERS = Object.freeze([
  "codex",
  "grok",
  "cursor",
  "agy",
  "opencode",
  "mimo",
  "minimax",
  "claude",
]);

/**
 * Validate resolved runtime manifests against the real filesystem, probe
 * executable versions without provider turns, and return a JSON-safe proof.
 */
export async function verifyRuntimeOwnership(options) {
  const appPath = await requireDirectory(options.appPath, "OkamiCode app");
  const userDataDirectory = await requireDirectory(
    options.userDataDirectory,
    "OkamiCode user-data",
  );
  if (!Array.isArray(options.runtimes) || options.runtimes.length === 0) {
    throw new Error("Runtime manifests are required");
  }

  const runtimes = [];
  const providers = new Set();
  for (const manifest of options.runtimes) {
    validateManifest(manifest);
    if (providers.has(manifest.provider)) {
      throw new Error(`Duplicate runtime manifest for ${manifest.provider}`);
    }
    providers.add(manifest.provider);

    if (manifest.entitlement === "token_plan") {
      if (manifest.source !== null) {
        throw new Error(
          `${manifest.provider} Token Plan must not declare an executable`,
        );
      }
      runtimes.push({
        provider: manifest.provider,
        transport: manifest.transport,
        entitlement: manifest.entitlement,
        version: "not-applicable",
        source: null,
        checksum: null,
        ownership: "token-plan",
        status: "pass",
      });
      continue;
    }

    if (manifest.external === true && manifest.provider !== "claude") {
      throw new Error(
        `Only Claude may be external; ${manifest.provider} was marked external`,
      );
    }
    if (!path.isAbsolute(manifest.source)) {
      throw new Error(
        `${manifest.provider} executable source must be an absolute path`,
      );
    }
    const source = await requireExecutable(manifest.source, manifest.provider);
    const ownership = containedBy(appPath, source)
      ? "app-bundle"
      : containedBy(userDataDirectory, source)
        ? "okami-user-data"
        : manifest.provider === "claude" && manifest.external === true
          ? "external"
          : null;
    if (ownership === null) {
      throw new Error(
        `${manifest.provider} executable resolves outside the OkamiCode app bundle and user-data directory: ${source}`,
      );
    }
    if (ownership === "external" && manifest.provider !== "claude") {
      throw new Error(`Only Claude may be external`);
    }

    const version = await inspectVersion({
      provider: manifest.provider,
      source,
      args: manifest.versionArgs ?? ["--version"],
      userDataDirectory,
      execute: options.execute,
    });
    runtimes.push({
      provider: manifest.provider,
      transport: manifest.transport,
      entitlement: manifest.entitlement,
      version,
      source,
      checksum: {
        algorithm: "sha256",
        value: await sha256File(source),
      },
      ownership,
      status: "pass",
    });
  }

  return {
    schemaVersion: 1,
    status: "pass",
    generatedAt: new Date().toISOString(),
    appPath,
    userDataDirectory,
    minimalPath: MINIMAL_PATH,
    runtimes,
  };
}

/**
 * Resolve the same packaged artifacts used by ManagedRuntimeCommands.
 */
export async function discoverPackagedRuntimes(options) {
  const appPath = path.resolve(options.appPath);
  const resourcesDirectory = path.join(appPath, "Contents", "Resources");
  const unpackedDirectory = path.join(resourcesDirectory, "app.asar.unpacked");
  const target = options.target ?? "darwin-arm64";
  if (target !== "darwin-arm64") {
    throw new Error(`Unsupported packaged verification target ${target}`);
  }

  await requireDirectory(appPath, "OkamiCode app");
  await requireDirectory(resourcesDirectory, "OkamiCode resources");
  await requireDirectory(unpackedDirectory, "unpacked application resources");

  const codex = await findUniqueFile(
    unpackedDirectory,
    (candidate) =>
      candidate.endsWith(
        `${path.sep}vendor${path.sep}aarch64-apple-darwin${path.sep}bin${path.sep}codex`,
      ) && candidate.includes(`${path.sep}@openai${path.sep}`),
    "managed Codex executable",
  );
  const grokCompressed = await findUniqueFile(
    unpackedDirectory,
    (candidate) =>
      candidate.endsWith(`${path.sep}bin${path.sep}grok.br`) &&
      candidate.includes(`${path.sep}@xai-official${path.sep}`),
    "managed Grok artifact",
  );
  const opencode = await findUniqueFile(
    unpackedDirectory,
    (candidate) =>
      candidate.endsWith(`${path.sep}bin${path.sep}opencode`) &&
      candidate.includes(`${path.sep}opencode-darwin-arm64${path.sep}`),
    "managed OpenCode executable",
  );
  const cursor = path.join(
    resourcesDirectory,
    "managed-runtimes",
    target,
    "cursor",
    "cursor-agent",
  );
  const agy = path.join(
    resourcesDirectory,
    "managed-runtimes",
    target,
    "agy",
    "agy",
  );
  const grok = await materializeGrokForVerification({
    compressedSource: grokCompressed,
    userDataDirectory: options.userDataDirectory,
    target,
  });
  const claude =
    options.claudeSource ??
    (await findExecutableOnPath(
      "claude",
      options.hostPath ?? process.env.PATH,
    ));
  if (!claude) {
    throw new Error(
      "Claude is the sole allowed external runtime, but no Claude executable was found",
    );
  }

  return [
    executableManifest("codex", "codex-managed", codex, "subscription"),
    executableManifest("grok", "grok-managed", grok, "subscription"),
    executableManifest("cursor", "cursor-agent", cursor, "subscription"),
    executableManifest("agy", "agy-cli", agy, "subscription"),
    executableManifest(
      "opencode",
      "opencode-acp",
      opencode,
      "provider_managed",
    ),
    tokenPlanManifest("mimo", "mimo-token-plan"),
    tokenPlanManifest("minimax", "minimax-token-plan"),
    {
      ...executableManifest("claude", "claude-cli", claude, "subscription"),
      external: true,
    },
  ];
}

export async function verifyManagedRuntimePackage(options) {
  const appPath = path.resolve(options.appPath);
  const userDataDirectory = path.resolve(
    options.userDataDirectory ??
      path.join(path.dirname(appPath), ".managed-runtime-verifier-user-data"),
  );
  await mkdir(userDataDirectory, { recursive: true, mode: 0o700 });
  const runtimes = await discoverPackagedRuntimes({
    appPath,
    userDataDirectory,
    claudeSource: options.claudeSource,
    hostPath: options.hostPath,
    target: options.target,
  });
  const discoveredProviders = runtimes.map((runtime) => runtime.provider);
  if (
    discoveredProviders.length !== EXPECTED_PROVIDERS.length ||
    EXPECTED_PROVIDERS.some(
      (provider, index) => discoveredProviders[index] !== provider,
    )
  ) {
    throw new Error(
      `Packaged runtime manifest set is incomplete: ${discoveredProviders.join(", ")}`,
    );
  }
  return verifyRuntimeOwnership({
    appPath,
    userDataDirectory,
    runtimes,
  });
}

function executableManifest(provider, transport, source, entitlement) {
  return {
    provider,
    transport,
    entitlement,
    source,
    versionArgs: ["--version"],
  };
}

function tokenPlanManifest(provider, transport) {
  return {
    provider,
    transport,
    entitlement: "token_plan",
    source: null,
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Runtime manifest must be an object");
  }
  if (typeof manifest.provider !== "string" || manifest.provider.length === 0) {
    throw new Error("Runtime manifest provider is required");
  }
  if (
    typeof manifest.transport !== "string" ||
    manifest.transport.length === 0
  ) {
    throw new Error(`${manifest.provider} runtime transport is required`);
  }
  if (manifest.entitlement === "token_plan") return;
  if (typeof manifest.source !== "string" || manifest.source.length === 0) {
    throw new Error(`${manifest.provider} executable source is required`);
  }
}

async function requireDirectory(candidate, label) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error(`${label} path must be absolute`);
  }
  let metadata;
  try {
    metadata = await stat(candidate);
  } catch {
    throw new Error(`${label} does not exist: ${candidate}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`${label} is not a directory: ${candidate}`);
  }
  return realpath(candidate);
}

async function requireExecutable(candidate, provider) {
  let canonical;
  try {
    canonical = await realpath(candidate);
    const metadata = await stat(canonical);
    if (!metadata.isFile()) throw new Error("not a file");
    await access(canonical, fsConstants.X_OK);
  } catch {
    throw new Error(`${provider} executable is missing or not executable`);
  }
  return canonical;
}

function containedBy(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function inspectVersion(options) {
  const environment = {
    PATH: MINIMAL_PATH,
    HOME: options.userDataDirectory,
    TMPDIR: tmpdir(),
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    CI: "1",
  };
  let result;
  try {
    result = options.execute
      ? await options.execute(options.source, options.args, {
          env: environment,
          timeout: 15_000,
        })
      : await execFileAsync(options.source, options.args, {
          env: environment,
          encoding: "utf8",
          timeout: 15_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });
  } catch (error) {
    throw new Error(
      `${options.provider} version probe failed without a provider turn: ${errorMessage(error)}`,
    );
  }
  const version = selectVersionOutput(result.stdout, result.stderr);
  if (!version) {
    throw new Error(`${options.provider} version probe returned no version`);
  }
  return version;
}

function selectVersionOutput(stdout, stderr) {
  const lines = `${String(stdout ?? "")}\n${String(stderr ?? "")}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.toLowerCase().startsWith("warning:") &&
        !line.toLowerCase().startsWith("warn "),
    );
  return lines.at(0) ?? null;
}

async function sha256File(candidate) {
  return createHash("sha256")
    .update(await readFile(candidate))
    .digest("hex");
}

async function findUniqueFile(root, predicate, label) {
  const matches = [];
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(candidate);
      } else if (entry.isFile() && predicate(candidate)) {
        matches.push(candidate);
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `${label} must resolve exactly once in the app bundle; found ${matches.length}`,
    );
  }
  return matches[0];
}

async function materializeGrokForVerification(options) {
  const payload = await brotliDecompressAsync(
    await readFile(options.compressedSource),
  );
  const targetDirectory = path.join(
    options.userDataDirectory,
    "managed-runtimes",
    "grok",
    options.target,
  );
  const target = path.join(targetDirectory, "grok");
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  if (await fileExists(target)) {
    const existing = await readFile(target);
    if (!Buffer.from(existing).equals(Buffer.from(payload))) {
      throw new Error(
        `Existing verification Grok executable does not match the packaged artifact: ${target}`,
      );
    }
    await chmod(target, 0o755);
    return target;
  }

  const temporary = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, payload, { flag: "wx", mode: 0o755 });
    await chmod(temporary, 0o755);
    await rename(temporary, target);
  } finally {
    try {
      await unlink(temporary);
    } catch {
      // Atomic rename consumed the temporary file.
    }
  }
  return target;
}

async function findExecutableOnPath(executableName, searchPath) {
  for (const directory of String(searchPath ?? "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, executableName);
    try {
      await access(candidate, fsConstants.X_OK);
      return realpath(candidate);
    } catch {
      // Continue to the next explicit host PATH entry. This lookup is Claude-only.
    }
  }
  return null;
}

async function fileExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseCliArguments(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--user-data") {
      options.userDataDirectory = argv[(index += 1)];
    } else if (argument === "--claude") {
      options.claudeSource = argv[(index += 1)];
    } else if (argument === "--target") {
      options.target = argv[(index += 1)];
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      "Usage: verify-managed-runtime-package <OkamiCode.app> [--user-data <directory>] [--claude <executable>]",
    );
  }
  return { ...options, appPath: positional[0] };
}

async function main() {
  try {
    const proof = await verifyManagedRuntimePackage(
      parseCliArguments(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          status: "fail",
          error: errorMessage(error),
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await main();
