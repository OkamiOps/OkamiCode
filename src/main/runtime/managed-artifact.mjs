/* global process */

import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export function materializeVerifiedArtifactSync(options) {
  mkdirSync(options.runtimeDirectory, { recursive: true });
  requireRegularDirectory(
    options.runtimeDirectory,
    "Managed runtime directory",
  );
  mkdirSync(options.targetDirectory, { recursive: true });
  requireRegularDirectory(
    options.targetDirectory,
    `Managed ${options.label} directory`,
  );
  const runtimeDirectory = realpathSync(options.runtimeDirectory);
  const targetDirectory = realpathSync(options.targetDirectory);
  if (!isContainedPath(runtimeDirectory, targetDirectory)) {
    throw new Error(
      `Managed ${options.label} directory escapes Okami runtime storage`,
    );
  }

  const target = path.join(options.targetDirectory, options.executableName);
  const expectedSha256 = sha256(options.payload);
  const existing = lstatIfExists(target);
  if (existing) {
    validateRegularTarget(target, options.label);
    const canonicalTarget = realpathSync(target);
    requireContainedTarget(runtimeDirectory, canonicalTarget, options.label);
    requireMatchingPayload(canonicalTarget, expectedSha256, options.label);
    if (process.platform !== "win32") chmodSync(canonicalTarget, 0o755);
    return canonicalTarget;
  }

  const temporary = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, options.payload, { flag: "wx", mode: 0o755 });
    if (process.platform !== "win32") chmodSync(temporary, 0o755);
    renameSync(temporary, target);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Atomic rename consumed the temporary file.
    }
  }

  validateRegularTarget(target, options.label);
  const canonicalTarget = realpathSync(target);
  requireContainedTarget(runtimeDirectory, canonicalTarget, options.label);
  requireMatchingPayload(canonicalTarget, expectedSha256, options.label);
  return canonicalTarget;
}

function requireRegularDirectory(candidate, label) {
  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
}

function validateRegularTarget(candidate, label) {
  const metadata = lstatSync(candidate);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Managed ${label} executable must not be a symlink`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Managed ${label} executable must be a regular file`);
  }
}

function requireContainedTarget(root, candidate, label) {
  if (!isContainedPath(root, candidate)) {
    throw new Error(
      `Managed ${label} executable escapes Okami runtime storage`,
    );
  }
}

function requireMatchingPayload(candidate, expectedSha256, label) {
  if (sha256(readFileSync(candidate)) !== expectedSha256) {
    throw new Error(
      `Managed ${label} executable does not match the packaged artifact`,
    );
  }
}

function lstatIfExists(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}
