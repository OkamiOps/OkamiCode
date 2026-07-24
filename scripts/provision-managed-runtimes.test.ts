import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

const provisioner = await import("./provision-managed-runtimes.mjs").catch(
  () => ({ provisionManagedRuntimes: undefined }),
);

it("provisions verified official archives into the packaged runtime cache", async () => {
  expect(provisioner.provisionManagedRuntimes).toBeTypeOf("function");
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "okami-runtime-provision-"),
  );
  const cursorArchive = Buffer.from("official-cursor-archive");
  const agyArchive = Buffer.from("official-antigravity-archive");
  const cursorSha512 = createHash("sha512").update(cursorArchive).digest("hex");
  const agySha512 = createHash("sha512").update(agyArchive).digest("hex");
  const manifestUrl = "https://official.example/manifest.json";
  const agyUrl = "https://official.example/agy.tar.gz";
  const cursorUrl = "https://official.example/cursor.tar.gz";
  const download = vi.fn(async (url: string) => {
    if (url === manifestUrl)
      return Buffer.from(
        JSON.stringify({ version: "1.0.0", url: agyUrl, sha512: agySha512 }),
      );
    if (url === cursorUrl) return cursorArchive;
    if (url === agyUrl) return agyArchive;
    throw new Error(`Unexpected URL ${url}`);
  });
  const extractArchive = vi.fn(
    async (
      archivePath: string,
      targetDirectory: string,
      options: { stripComponents?: number; member?: string },
    ) => {
      mkdirSync(targetDirectory, { recursive: true });
      if (options.stripComponents === 1)
        writeFileSync(
          path.join(targetDirectory, "cursor-agent"),
          readFileSync(archivePath),
        );
      if (options.member === "antigravity")
        writeFileSync(
          path.join(targetDirectory, "antigravity"),
          readFileSync(archivePath),
        );
    },
  );

  const result = await provisioner.provisionManagedRuntimes!({
    outputDirectory,
    platform: "darwin",
    arch: "arm64",
    cursor: { version: "test", url: cursorUrl, sha512: cursorSha512 },
    antigravityManifestUrl: manifestUrl,
    download,
    extractArchive,
  });

  expect(readFileSync(result.cursor, "utf8")).toBe("official-cursor-archive");
  expect(readFileSync(result.agy, "utf8")).toBe("official-antigravity-archive");
  expect(download.mock.calls.map(([url]) => url)).toEqual([
    cursorUrl,
    manifestUrl,
    agyUrl,
  ]);
  expect(extractArchive).toHaveBeenCalledTimes(2);
});

it("rejects a Cursor archive that does not match the pinned SHA-512", async () => {
  expect(provisioner.provisionManagedRuntimes).toBeTypeOf("function");
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "okami-runtime-provision-"),
  );
  const extractArchive = vi.fn();

  await expect(
    provisioner.provisionManagedRuntimes!({
      outputDirectory,
      platform: "darwin",
      arch: "arm64",
      cursor: {
        version: "test",
        url: "https://official.example/cursor.tar.gz",
        sha512: "0".repeat(128),
      },
      antigravityManifestUrl: "https://official.example/manifest.json",
      download: async () => Buffer.from("tampered"),
      extractArchive,
    }),
  ).rejects.toThrow("Cursor archive SHA-512 mismatch");
  expect(extractArchive).not.toHaveBeenCalled();
});

it("rejects an Antigravity archive that does not match its official manifest", async () => {
  expect(provisioner.provisionManagedRuntimes).toBeTypeOf("function");
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "okami-runtime-provision-"),
  );
  const cursorArchive = Buffer.from("official-cursor-archive");
  const extractArchive = vi.fn(
    async (
      archivePath: string,
      targetDirectory: string,
      options: { stripComponents?: number },
    ) => {
      if (options.stripComponents === 1) {
        mkdirSync(targetDirectory, { recursive: true });
        writeFileSync(
          path.join(targetDirectory, "cursor-agent"),
          readFileSync(archivePath),
        );
      }
    },
  );

  await expect(
    provisioner.provisionManagedRuntimes!({
      outputDirectory,
      platform: "darwin",
      arch: "arm64",
      cursor: {
        version: "test",
        url: "https://official.example/cursor.tar.gz",
        sha512: createHash("sha512").update(cursorArchive).digest("hex"),
      },
      antigravityManifestUrl: "https://official.example/manifest.json",
      download: async (url: string) =>
        url.endsWith("manifest.json")
          ? Buffer.from(
              JSON.stringify({
                version: "1.0.0",
                url: "https://official.example/agy.tar.gz",
                sha512: "0".repeat(128),
              }),
            )
          : url.endsWith("cursor.tar.gz")
            ? cursorArchive
            : Buffer.from("tampered"),
      extractArchive,
    }),
  ).rejects.toThrow("Antigravity archive SHA-512 mismatch");
  expect(extractArchive).toHaveBeenCalledTimes(1);
});
