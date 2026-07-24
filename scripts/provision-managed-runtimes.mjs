/* global Buffer, URL, fetch, process */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export const CURSOR_DARWIN_ARM64 = Object.freeze({
  version: "2026.07.23-e383d2b",
  url: "https://downloads.cursor.com/lab/2026.07.23-e383d2b/darwin/arm64/agent-cli-package.tar.gz",
  sha512:
    "2e98b8d49e9d67a70b68ecf956531124828aa8b4751f9ece36df3701876902a8aed2f32308ee9f301461cd026b4e2c9d3bd4508603b7ef8f37c136b7de7dccdb",
});

export const ANTIGRAVITY_DARWIN_ARM64_MANIFEST_URL =
  "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json";

export const ANTIGRAVITY_DARWIN_ARM64 = Object.freeze({
  version: "1.1.6",
  url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.1.6-6535449645285376/darwin-arm/cli_mac_arm64.tar.gz",
  sha512:
    "76b801b2c52eb106ec25073bda5d61a28bc3ff78f79631675642b743cd39fe2e5039a14211d03cabee88bf03450785af5859d1e7ca47c5c51e0676389b4b9d45",
});

export async function provisionManagedRuntimes(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = `${platform}-${arch}`;
  if (target !== "darwin-arm64") {
    throw new Error(`Unsupported managed provisioning target ${target}`);
  }

  const outputDirectory =
    options.outputDirectory ?? path.resolve(".cache", "managed-runtimes");
  const targetDirectory = path.join(outputDirectory, target);
  const archiveDirectory = path.join(outputDirectory, ".archives");
  const cursor = options.cursor ?? CURSOR_DARWIN_ARM64;
  const antigravity = options.antigravity ?? ANTIGRAVITY_DARWIN_ARM64;
  const antigravityManifestUrl =
    options.antigravityManifestUrl ?? ANTIGRAVITY_DARWIN_ARM64_MANIFEST_URL;
  const download = options.download ?? downloadBuffer;
  const inspectArchive =
    options.inspectArchive ??
    (options.listArchive
      ? async (archivePath) =>
          (await options.listArchive(archivePath)).map((name) => ({
            name,
            type: "file",
          }))
      : inspectTarGzip);
  const extractArchive = options.extractArchive ?? extractTarGzip;
  const fileOperations = {
    rename: options.fileOperations?.rename ?? rename,
  };

  validateHttpsUrl(cursor.url, "Cursor archive");
  validateSha512(cursor.sha512, "Cursor");
  validateRelease(antigravity, "Antigravity");
  validateHttpsUrl(antigravityManifestUrl, "Antigravity manifest");
  await mkdir(archiveDirectory, { recursive: true });

  const cursorArchive = await download(cursor.url);
  verifySha512(cursorArchive, cursor.sha512, "Cursor");
  const cursorArchivePath = path.join(
    archiveDirectory,
    `cursor-${cursor.version}.tar.gz`,
  );
  await writeFile(cursorArchivePath, cursorArchive);
  validateArchiveEntries(await inspectArchive(cursorArchivePath), "Cursor");
  const cursorExecutable = await installRuntimeAtomically({
    targetDirectory: path.join(targetDirectory, "cursor"),
    runtime: "Cursor",
    executableName: "cursor-agent",
    prepare: (stagingDirectory) =>
      extractArchive(cursorArchivePath, stagingDirectory, {
        stripComponents: 1,
      }),
    fileOperations,
  });

  const manifestPayload = await download(antigravityManifestUrl);
  const manifest = parseAntigravityManifest(manifestPayload, antigravity);
  const agyArchive = await download(manifest.url);
  verifySha512(agyArchive, manifest.sha512, "Antigravity");
  const agyArchivePath = path.join(
    archiveDirectory,
    `antigravity-${manifest.version}.tar.gz`,
  );
  await writeFile(agyArchivePath, agyArchive);
  validateArchiveEntries(await inspectArchive(agyArchivePath), "Antigravity");
  const agyExecutable = await installRuntimeAtomically({
    targetDirectory: path.join(targetDirectory, "agy"),
    runtime: "Antigravity",
    executableName: "agy",
    prepare: async (stagingDirectory) => {
      await extractArchive(agyArchivePath, stagingDirectory, {
        member: "antigravity",
      });
      await fileOperations.rename(
        path.join(stagingDirectory, "antigravity"),
        path.join(stagingDirectory, "agy"),
      );
    },
    fileOperations,
  });

  return {
    cursor: cursorExecutable,
    agy: agyExecutable,
    cursorVersion: cursor.version,
    antigravityVersion: manifest.version,
  };
}

function parseAntigravityManifest(payload, expected) {
  let manifest;
  try {
    manifest = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("Antigravity release manifest is invalid JSON");
  }
  if (
    !manifest ||
    typeof manifest.version !== "string" ||
    typeof manifest.url !== "string" ||
    typeof manifest.sha512 !== "string"
  ) {
    throw new Error("Antigravity release manifest is incomplete");
  }
  validateHttpsUrl(manifest.url, "Antigravity archive");
  validateSha512(manifest.sha512, "Antigravity");
  if (
    manifest.version !== expected.version ||
    manifest.url !== expected.url ||
    manifest.sha512.toLowerCase() !== expected.sha512.toLowerCase()
  ) {
    throw new Error("Antigravity manifest does not match pinned release");
  }
  return manifest;
}

async function downloadBuffer(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function extractTarGzip(archivePath, targetDirectory, options) {
  const args = ["-xzf", archivePath, "-C", targetDirectory];
  if (options.stripComponents) {
    args.push(`--strip-components=${options.stripComponents}`);
  }
  if (options.member) args.push(options.member);
  await execFileAsync("tar", args, { windowsHide: true });
}

async function inspectTarGzip(archivePath) {
  const { stdout } = await execFileAsync("tar", ["-tvzf", archivePath], {
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout.split("\n").filter(Boolean).map(parseTarVerboseEntry);
}

function parseTarVerboseEntry(line) {
  const match =
    /^([bcdhlps-])[rwxStTs-]{9}\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)$/u.exec(
      line,
    );
  if (!match) {
    throw new Error(`Tar archive metadata is invalid: ${line}`);
  }
  const type = tarEntryType(match[1]);
  let name = match[2];
  let linkTarget;
  if (type === "symlink" || type === "hardlink") {
    const separator = type === "symlink" ? " -> " : " link to ";
    const separatorIndex = name.lastIndexOf(separator);
    if (separatorIndex < 1) {
      throw new Error(`Tar link metadata is invalid: ${line}`);
    }
    linkTarget = name.slice(separatorIndex + separator.length);
    name = name.slice(0, separatorIndex);
  }
  return { name, type, linkTarget };
}

function tarEntryType(type) {
  if (type === "-") return "file";
  if (type === "d") return "directory";
  if (type === "l") return "symlink";
  if (type === "h") return "hardlink";
  return "special";
}

function validateArchiveEntries(entries, runtime) {
  for (const entry of entries) {
    validateArchivePath(entry.name, runtime, "member");
    if (entry.linkTarget !== undefined) {
      validateArchivePath(entry.linkTarget, runtime, "link target");
    }
    if (entry.type !== "file" && entry.type !== "directory") {
      throw new Error(
        `${runtime} archive contains unsupported member type ${entry.type}`,
      );
    }
  }
}

function validateArchivePath(candidate, runtime, label) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${runtime} archive contains invalid ${label}`);
  }
  const segments = candidate.split(/[\\/]/u);
  if (
    path.posix.isAbsolute(candidate) ||
    path.win32.isAbsolute(candidate) ||
    segments.includes("..")
  ) {
    throw new Error(`${runtime} archive contains unsafe ${label} ${candidate}`);
  }
}

async function installRuntimeAtomically(options) {
  const parentDirectory = path.dirname(options.targetDirectory);
  await mkdir(parentDirectory, { recursive: true });
  const stagingDirectory = await mkdtemp(
    path.join(
      parentDirectory,
      `.${path.basename(options.targetDirectory)}-staging-`,
    ),
  );
  let backupDirectory;
  let backupTarget;
  let preserveBackup = false;
  try {
    await options.prepare(stagingDirectory);
    const stagingExecutable = path.join(
      stagingDirectory,
      options.executableName,
    );
    await requireContainedFile(
      stagingDirectory,
      stagingExecutable,
      options.runtime,
    );
    await chmod(stagingExecutable, 0o755);

    if (await pathExists(options.targetDirectory)) {
      backupDirectory = await mkdtemp(
        path.join(
          parentDirectory,
          `.${path.basename(options.targetDirectory)}-backup-`,
        ),
      );
      backupTarget = path.join(
        backupDirectory,
        path.basename(options.targetDirectory),
      );
      await options.fileOperations.rename(
        options.targetDirectory,
        backupTarget,
      );
    }

    try {
      await options.fileOperations.rename(
        stagingDirectory,
        options.targetDirectory,
      );
    } catch (swapError) {
      if (backupTarget && !(await pathExists(options.targetDirectory))) {
        try {
          await options.fileOperations.rename(
            backupTarget,
            options.targetDirectory,
          );
        } catch (restoreError) {
          preserveBackup = true;
          throw new Error(
            `Managed runtime swap failed: ${errorMessage(swapError)}; rollback restore failed: ${errorMessage(restoreError)}. Recoverable backup: ${backupTarget}`,
            { cause: new AggregateError([swapError, restoreError]) },
          );
        }
      }
      throw swapError;
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
    if (backupDirectory && !preserveBackup) {
      await rm(backupDirectory, { recursive: true, force: true });
    }
  }
  return path.join(options.targetDirectory, options.executableName);
}

function verifySha512(payload, expected, runtime) {
  const actual = createHash("sha512").update(payload).digest("hex");
  if (actual !== expected.toLowerCase()) {
    throw new Error(`${runtime} archive SHA-512 mismatch`);
  }
}

function validateRelease(release, runtime) {
  if (!release || typeof release.version !== "string") {
    throw new Error(`${runtime} release version is invalid`);
  }
  validateHttpsUrl(release.url, `${runtime} archive`);
  validateSha512(release.sha512, runtime);
}

function validateSha512(value, runtime) {
  if (!/^[a-f0-9]{128}$/iu.test(value)) {
    throw new Error(`${runtime} SHA-512 is invalid`);
  }
}

function validateHttpsUrl(value, label) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} URL must use HTTPS`);
  }
}

async function requireContainedFile(root, candidate, runtime) {
  const metadata = await lstat(candidate).catch(() => null);
  if (!metadata?.isFile()) {
    throw new Error(`${runtime} archive did not contain its executable`);
  }
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative === "" ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${runtime} executable escaped its staging directory`);
  }
}

async function pathExists(candidate) {
  return Boolean(await stat(candidate).catch(() => null));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const provisioned = await provisionManagedRuntimes();
  process.stdout.write(
    `Provisioned Cursor ${provisioned.cursorVersion} and Antigravity ${provisioned.antigravityVersion}\n`,
  );
}
