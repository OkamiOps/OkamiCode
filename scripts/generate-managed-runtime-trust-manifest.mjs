/* global process */

import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildManagedRuntimeTrustManifest,
  TRUST_MANIFEST_NAME,
} from "./verify-managed-runtime-package.mjs";

export async function generateManagedRuntimeTrustManifest(options) {
  const appPath = path.resolve(options.appPath);
  const manifest = await buildManagedRuntimeTrustManifest({ appPath });
  const destination = path.join(
    appPath,
    "Contents",
    "Resources",
    TRUST_MANIFEST_NAME,
  );
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporary, destination);
  } finally {
    try {
      await unlink(temporary);
    } catch {
      // Atomic rename consumed the temporary file.
    }
  }
  return manifest;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  await generateManagedRuntimeTrustManifest({ appPath });
}
