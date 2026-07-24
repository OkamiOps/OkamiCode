/* global Buffer, URL, fetch, process */

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, rename, stat, writeFile } from "node:fs/promises";
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
  const antigravityManifestUrl =
    options.antigravityManifestUrl ?? ANTIGRAVITY_DARWIN_ARM64_MANIFEST_URL;
  const download = options.download ?? downloadBuffer;
  const extractArchive = options.extractArchive ?? extractTarGzip;

  validateHttpsUrl(cursor.url, "Cursor archive");
  validateSha512(cursor.sha512, "Cursor");
  validateHttpsUrl(antigravityManifestUrl, "Antigravity manifest");
  await mkdir(archiveDirectory, { recursive: true });

  const cursorArchive = await download(cursor.url);
  verifySha512(cursorArchive, cursor.sha512, "Cursor");
  const cursorArchivePath = path.join(
    archiveDirectory,
    `cursor-${cursor.version}.tar.gz`,
  );
  await writeFile(cursorArchivePath, cursorArchive);
  const cursorDirectory = path.join(targetDirectory, "cursor");
  await mkdir(cursorDirectory, { recursive: true });
  await extractArchive(cursorArchivePath, cursorDirectory, {
    stripComponents: 1,
  });
  const cursorExecutable = path.join(cursorDirectory, "cursor-agent");
  await requireFile(cursorExecutable, "Cursor");
  await chmod(cursorExecutable, 0o755);

  const manifestPayload = await download(antigravityManifestUrl);
  const manifest = parseAntigravityManifest(manifestPayload);
  const agyArchive = await download(manifest.url);
  verifySha512(agyArchive, manifest.sha512, "Antigravity");
  const agyArchivePath = path.join(
    archiveDirectory,
    `antigravity-${manifest.version}.tar.gz`,
  );
  await writeFile(agyArchivePath, agyArchive);
  const agyDirectory = path.join(targetDirectory, "agy");
  await mkdir(agyDirectory, { recursive: true });
  await extractArchive(agyArchivePath, agyDirectory, {
    member: "antigravity",
  });
  const extractedAgy = path.join(agyDirectory, "antigravity");
  await requireFile(extractedAgy, "Antigravity");
  const agyExecutable = path.join(agyDirectory, "agy");
  await rename(extractedAgy, agyExecutable);
  await chmod(agyExecutable, 0o755);

  return {
    cursor: cursorExecutable,
    agy: agyExecutable,
    cursorVersion: cursor.version,
    antigravityVersion: manifest.version,
  };
}

function parseAntigravityManifest(payload) {
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

function verifySha512(payload, expected, runtime) {
  const actual = createHash("sha512").update(payload).digest("hex");
  if (actual !== expected.toLowerCase()) {
    throw new Error(`${runtime} archive SHA-512 mismatch`);
  }
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

async function requireFile(candidate, runtime) {
  const metadata = await stat(candidate).catch(() => null);
  if (!metadata?.isFile()) {
    throw new Error(`${runtime} archive did not contain its executable`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const provisioned = await provisionManagedRuntimes();
  process.stdout.write(
    `Provisioned Cursor ${provisioned.cursorVersion} and Antigravity ${provisioned.antigravityVersion}\n`,
  );
}
