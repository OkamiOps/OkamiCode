/* global process */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { brotliDecompress } from "node:zlib";
import { materializeVerifiedArtifactSync } from "../src/main/runtime/managed-artifact.mjs";

const execFileAsync = promisify(execFile);
const brotliDecompressAsync = promisify(brotliDecompress);

export const MINIMAL_PATH = "/usr/bin:/bin";
export const TRUST_MANIFEST_NAME = "managed-runtime-trust-manifest.json";

const PROVIDER_CONTRACTS = Object.freeze([
  Object.freeze({
    provider: "codex",
    transport: "codex-managed",
    entitlement: "subscription",
    ownership: "app-bundle",
    artifactEncoding: "identity",
  }),
  Object.freeze({
    provider: "grok",
    transport: "grok-managed",
    entitlement: "subscription",
    ownership: "okami-user-data",
    artifactEncoding: "brotli",
  }),
  Object.freeze({
    provider: "cursor",
    transport: "cursor-agent",
    entitlement: "subscription",
    ownership: "app-bundle",
    artifactEncoding: "identity",
  }),
  Object.freeze({
    provider: "agy",
    transport: "agy-cli",
    entitlement: "subscription",
    ownership: "app-bundle",
    artifactEncoding: "identity",
  }),
  Object.freeze({
    provider: "opencode",
    transport: "opencode-acp",
    entitlement: "provider_managed",
    ownership: "app-bundle",
    artifactEncoding: "identity",
  }),
  Object.freeze({
    provider: "mimo",
    transport: "mimo-token-plan",
    entitlement: "token_plan",
    ownership: "token-plan",
    artifactEncoding: null,
  }),
  Object.freeze({
    provider: "minimax",
    transport: "minimax-token-plan",
    entitlement: "token_plan",
    ownership: "token-plan",
    artifactEncoding: null,
  }),
  Object.freeze({
    provider: "claude",
    transport: "claude-cli",
    entitlement: "subscription",
    ownership: "external",
    artifactEncoding: null,
  }),
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

    const observedSha256 = await sha256File(source);
    if (
      options.requireExpectedChecksums === true &&
      ownership !== "external" &&
      !isSha256(manifest.expectedSha256)
    ) {
      throw new Error(
        `${manifest.provider} expected SHA-256 is missing from the trust manifest`,
      );
    }
    if (
      isSha256(manifest.expectedSha256) &&
      observedSha256 !== manifest.expectedSha256
    ) {
      throw new Error(`${manifest.provider} SHA-256 mismatch`);
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
        value: observedSha256,
        expected: manifest.expectedSha256 ?? null,
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
  const target = options.target ?? "darwin-arm64";
  if (target !== "darwin-arm64") {
    throw new Error(`Unsupported packaged verification target ${target}`);
  }

  await requireDirectory(appPath, "OkamiCode app");
  await requireDirectory(resourcesDirectory, "OkamiCode resources");
  const trustManifest =
    options.trustManifest ??
    (await readManagedRuntimeTrustManifest(appPath)).manifest;
  validateTrustManifest(trustManifest);
  const entries = new Map(
    trustManifest.providers.map((entry) => [entry.provider, entry]),
  );
  const sources = new Map();
  for (const contract of PROVIDER_CONTRACTS) {
    if (
      contract.ownership === "token-plan" ||
      contract.ownership === "external"
    ) {
      continue;
    }
    const entry = entries.get(contract.provider);
    const artifact = await requireTrustedArtifact(resourcesDirectory, entry);
    const packagedPayload = await readFile(artifact);
    const executablePayload =
      entry.artifactEncoding === "brotli"
        ? await brotliDecompressAsync(packagedPayload)
        : packagedPayload;
    const observedSha256 = sha256Buffer(executablePayload);
    if (observedSha256 !== entry.sha256) {
      throw new Error(`${displayProvider(contract.provider)} SHA-256 mismatch`);
    }
    if (contract.provider === "grok") {
      sources.set(
        contract.provider,
        materializeVerifiedArtifactSync({
          runtimeDirectory: path.join(
            options.userDataDirectory,
            "managed-runtimes",
          ),
          targetDirectory: path.join(
            options.userDataDirectory,
            "managed-runtimes",
            "grok",
            target,
          ),
          executableName: "grok",
          label: "Grok",
          payload: executablePayload,
        }),
      );
    } else {
      sources.set(contract.provider, artifact);
    }
  }
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

  return PROVIDER_CONTRACTS.map((contract) => {
    const entry = entries.get(contract.provider);
    if (contract.ownership === "token-plan") {
      return tokenPlanManifest(contract.provider, contract.transport);
    }
    if (contract.ownership === "external") {
      return {
        ...executableManifest(
          contract.provider,
          contract.transport,
          claude,
          contract.entitlement,
        ),
        external: true,
      };
    }
    return {
      ...executableManifest(
        contract.provider,
        contract.transport,
        sources.get(contract.provider),
        contract.entitlement,
      ),
      expectedSha256: entry.sha256,
    };
  });
}

export async function verifyManagedRuntimePackage(options) {
  const appPath = path.resolve(options.appPath);
  const userDataDirectory = path.resolve(
    options.userDataDirectory ??
      path.join(path.dirname(appPath), ".managed-runtime-verifier-user-data"),
  );
  await mkdir(userDataDirectory, { recursive: true, mode: 0o700 });
  const trust = await readManagedRuntimeTrustManifest(appPath);
  const runtimes = await discoverPackagedRuntimes({
    appPath,
    userDataDirectory,
    claudeSource: options.claudeSource,
    hostPath: options.hostPath,
    target: options.target,
    trustManifest: trust.manifest,
  });
  const proof = await verifyRuntimeOwnership({
    appPath,
    userDataDirectory,
    runtimes,
    requireExpectedChecksums: true,
  });
  return {
    ...proof,
    trustManifest: {
      source: trust.source,
      checksum: {
        algorithm: "sha256",
        value: trust.checksum,
      },
    },
  };
}

export async function buildManagedRuntimeTrustManifest(options) {
  const appPath = path.resolve(options.appPath);
  const resourcesDirectory = path.join(appPath, "Contents", "Resources");
  const unpackedDirectory = path.join(resourcesDirectory, "app.asar.unpacked");
  await requireDirectory(appPath, "OkamiCode app");
  await requireDirectory(resourcesDirectory, "OkamiCode resources");
  await requireDirectory(unpackedDirectory, "unpacked application resources");
  const canonicalResourcesDirectory = await realpath(resourcesDirectory);

  const discovered = new Map([
    [
      "codex",
      await findUniqueFile(
        unpackedDirectory,
        (candidate) =>
          candidate.endsWith(
            `${path.sep}vendor${path.sep}aarch64-apple-darwin${path.sep}bin${path.sep}codex`,
          ) && candidate.includes(`${path.sep}@openai${path.sep}`),
        "managed Codex executable",
      ),
    ],
    [
      "grok",
      await findUniqueFile(
        unpackedDirectory,
        (candidate) =>
          candidate.endsWith(`${path.sep}bin${path.sep}grok.br`) &&
          candidate.includes(`${path.sep}@xai-official${path.sep}`),
        "managed Grok artifact",
      ),
    ],
    [
      "cursor",
      path.join(
        resourcesDirectory,
        "managed-runtimes",
        "darwin-arm64",
        "cursor",
        "cursor-agent",
      ),
    ],
    [
      "agy",
      path.join(
        resourcesDirectory,
        "managed-runtimes",
        "darwin-arm64",
        "agy",
        "agy",
      ),
    ],
    [
      "opencode",
      await findUniqueFile(
        unpackedDirectory,
        (candidate) =>
          candidate.endsWith(`${path.sep}bin${path.sep}opencode`) &&
          candidate.includes(`${path.sep}opencode-darwin-arm64${path.sep}`),
        "managed OpenCode executable",
      ),
    ],
  ]);

  const providers = [];
  for (const contract of PROVIDER_CONTRACTS) {
    if (
      contract.ownership === "token-plan" ||
      contract.ownership === "external"
    ) {
      providers.push({
        ...contract,
        artifact: null,
        sha256: null,
      });
      continue;
    }
    const artifact = await requireContainedRegularFile(
      resourcesDirectory,
      discovered.get(contract.provider),
      `managed ${displayProvider(contract.provider)} artifact`,
    );
    const packagedPayload = await readFile(artifact);
    const executablePayload =
      contract.artifactEncoding === "brotli"
        ? await brotliDecompressAsync(packagedPayload)
        : packagedPayload;
    providers.push({
      ...contract,
      artifact: path
        .relative(canonicalResourcesDirectory, artifact)
        .split(path.sep)
        .join("/"),
      sha256: sha256Buffer(executablePayload),
    });
  }
  return {
    schemaVersion: 1,
    target: "darwin-arm64",
    hashAlgorithm: "sha256",
    generatedAt: new Date().toISOString(),
    providers,
  };
}

async function readManagedRuntimeTrustManifest(appPath) {
  const resourcesDirectory = path.join(appPath, "Contents", "Resources");
  const source = path.join(resourcesDirectory, TRUST_MANIFEST_NAME);
  let metadata;
  try {
    metadata = await lstat(source);
  } catch {
    throw new Error(`Managed runtime trust manifest is missing: ${source}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Managed runtime trust manifest must be a regular file");
  }
  const canonicalSource = await realpath(source);
  const canonicalResources = await realpath(resourcesDirectory);
  if (!containedBy(canonicalResources, canonicalSource)) {
    throw new Error("Managed runtime trust manifest escapes the app bundle");
  }
  const payload = await readFile(canonicalSource);
  let manifest;
  try {
    manifest = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("Managed runtime trust manifest is invalid JSON");
  }
  validateTrustManifest(manifest);
  return {
    source: canonicalSource,
    checksum: sha256Buffer(payload),
    manifest,
  };
}

function validateTrustManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.schemaVersion !== 1 ||
    manifest.target !== "darwin-arm64" ||
    manifest.hashAlgorithm !== "sha256" ||
    !Array.isArray(manifest.providers)
  ) {
    throw new Error("Managed runtime trust manifest has an invalid schema");
  }
  const providers = new Map();
  for (const entry of manifest.providers) {
    if (!entry || typeof entry.provider !== "string") {
      throw new Error(
        "Managed runtime trust manifest contains an invalid provider",
      );
    }
    if (providers.has(entry.provider)) {
      throw new Error(
        `Managed runtime trust manifest duplicates provider ${entry.provider}`,
      );
    }
    providers.set(entry.provider, entry);
  }
  for (const contract of PROVIDER_CONTRACTS) {
    if (!providers.has(contract.provider)) {
      throw new Error(
        `Managed runtime trust manifest is missing provider ${contract.provider}`,
      );
    }
  }
  for (const provider of providers.keys()) {
    if (
      !PROVIDER_CONTRACTS.some((contract) => contract.provider === provider)
    ) {
      throw new Error(
        `Managed runtime trust manifest contains unexpected provider ${provider}`,
      );
    }
  }
  for (const contract of PROVIDER_CONTRACTS) {
    const entry = providers.get(contract.provider);
    if (
      entry.transport !== contract.transport ||
      entry.entitlement !== contract.entitlement ||
      entry.ownership !== contract.ownership ||
      entry.artifactEncoding !== contract.artifactEncoding
    ) {
      throw new Error(
        `Managed runtime trust manifest contract mismatch for ${contract.provider}`,
      );
    }
    if (
      contract.ownership === "token-plan" ||
      contract.ownership === "external"
    ) {
      if (entry.artifact !== null || entry.sha256 !== null) {
        throw new Error(
          `Managed runtime trust manifest must not hash ${contract.provider}`,
        );
      }
    } else if (!isSafeArtifactPath(entry.artifact) || !isSha256(entry.sha256)) {
      throw new Error(
        `Managed runtime trust manifest artifact is invalid for ${contract.provider}`,
      );
    }
  }
}

async function requireTrustedArtifact(resourcesDirectory, entry) {
  const candidate = path.join(resourcesDirectory, ...entry.artifact.split("/"));
  return requireContainedRegularFile(
    resourcesDirectory,
    candidate,
    `${displayProvider(entry.provider)} trusted artifact`,
  );
}

async function requireContainedRegularFile(root, candidate, label) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) {
    throw new Error(`${label} path must be absolute`);
  }
  let metadata;
  try {
    metadata = await lstat(candidate);
  } catch {
    throw new Error(`${label} is missing: ${candidate}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(candidate);
  if (!containedBy(canonicalRoot, canonicalCandidate)) {
    throw new Error(`${label} escapes the app bundle`);
  }
  return canonicalCandidate;
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
  return sha256Buffer(await readFile(candidate));
}

function sha256Buffer(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function isSha256(candidate) {
  return typeof candidate === "string" && /^[a-f0-9]{64}$/u.test(candidate);
}

function isSafeArtifactPath(candidate) {
  return (
    typeof candidate === "string" &&
    candidate.length > 0 &&
    !path.posix.isAbsolute(candidate) &&
    !path.win32.isAbsolute(candidate) &&
    !candidate.split(/[\\/]/u).includes("..")
  );
}

function displayProvider(provider) {
  const labels = {
    agy: "Antigravity",
    claude: "Claude",
    codex: "Codex",
    cursor: "Cursor",
    grok: "Grok",
    mimo: "MiMo",
    minimax: "MiniMax",
    opencode: "OpenCode",
  };
  return labels[provider] ?? provider;
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
