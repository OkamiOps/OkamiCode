import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const antigravity = {
    version: "1.0.0",
    url: agyUrl,
    sha512: agySha512,
  };
  const download = vi.fn(async (url: string) => {
    if (url === manifestUrl) return Buffer.from(JSON.stringify(antigravity));
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
    antigravity,
    antigravityManifestUrl: manifestUrl,
    download,
    listArchive: async (archivePath: string) =>
      archivePath.includes("cursor-")
        ? ["dist-package/cursor-agent"]
        : ["antigravity"],
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
  expect(
    extractArchive.mock.calls.every(([, target]) =>
      path.basename(target).includes("-staging-"),
    ),
  ).toBe(true);
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
      antigravity: {
        version: "1.0.0",
        url: "https://official.example/agy.tar.gz",
        sha512: "0".repeat(128),
      },
      antigravityManifestUrl: "https://official.example/manifest.json",
      download: async () => Buffer.from("tampered"),
      listArchive: vi.fn(),
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
  const agyUrl = "https://official.example/agy.tar.gz";
  const antigravity = {
    version: "1.0.0",
    url: agyUrl,
    sha512: "0".repeat(128),
  };
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
      antigravity,
      antigravityManifestUrl: "https://official.example/manifest.json",
      download: async (url: string) =>
        url.endsWith("manifest.json")
          ? Buffer.from(JSON.stringify(antigravity))
          : url.endsWith("cursor.tar.gz")
            ? cursorArchive
            : Buffer.from("tampered"),
      listArchive: async (archivePath: string) =>
        archivePath.includes("cursor-")
          ? ["dist-package/cursor-agent"]
          : ["antigravity"],
      extractArchive,
    }),
  ).rejects.toThrow("Antigravity archive SHA-512 mismatch");
  expect(extractArchive).toHaveBeenCalledTimes(1);
});

it("rejects an Antigravity manifest that diverges from the pinned release", async () => {
  expect(provisioner.provisionManagedRuntimes).toBeTypeOf("function");
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "okami-runtime-provision-"),
  );
  const cursorArchive = Buffer.from("official-cursor-archive");
  const agyArchive = Buffer.from("official-antigravity-archive");
  const antigravity = {
    version: "1.0.0",
    url: "https://official.example/agy.tar.gz",
    sha512: createHash("sha512").update(agyArchive).digest("hex"),
  };
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
      antigravity,
      antigravityManifestUrl: "https://official.example/manifest.json",
      download: async (url: string) =>
        url.endsWith("manifest.json")
          ? Buffer.from(
              JSON.stringify({ ...antigravity, version: "unexpected" }),
            )
          : cursorArchive,
      listArchive: async () => ["dist-package/cursor-agent"],
      extractArchive,
    }),
  ).rejects.toThrow("Antigravity manifest does not match pinned release");
  expect(extractArchive).toHaveBeenCalledTimes(1);
});

it("replaces each runtime atomically on an idempotent rerun", async () => {
  expect(provisioner.provisionManagedRuntimes).toBeTypeOf("function");
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "okami-runtime-provision-"),
  );
  const cursorArchive = Buffer.from("official-cursor-archive");
  const agyArchive = Buffer.from("official-antigravity-archive");
  const cursorUrl = "https://official.example/cursor.tar.gz";
  const manifestUrl = "https://official.example/manifest.json";
  const antigravity = {
    version: "1.0.0",
    url: "https://official.example/agy.tar.gz",
    sha512: createHash("sha512").update(agyArchive).digest("hex"),
  };
  const options = {
    outputDirectory,
    platform: "darwin",
    arch: "arm64",
    cursor: {
      version: "test",
      url: cursorUrl,
      sha512: createHash("sha512").update(cursorArchive).digest("hex"),
    },
    antigravity,
    antigravityManifestUrl: manifestUrl,
    download: async (url: string) => {
      if (url === cursorUrl) return cursorArchive;
      if (url === manifestUrl) return Buffer.from(JSON.stringify(antigravity));
      return agyArchive;
    },
    listArchive: async (archivePath: string) =>
      archivePath.includes("cursor-")
        ? ["dist-package/cursor-agent"]
        : ["antigravity"],
    extractArchive: async (
      archivePath: string,
      targetDirectory: string,
      extractOptions: { stripComponents?: number; member?: string },
    ) => {
      mkdirSync(targetDirectory, { recursive: true });
      writeFileSync(
        path.join(targetDirectory, extractOptions.member ?? "cursor-agent"),
        readFileSync(archivePath),
      );
    },
  };

  const first = await provisioner.provisionManagedRuntimes!(options);
  const staleCursorFile = path.join(path.dirname(first.cursor), "stale");
  const staleAgyFile = path.join(path.dirname(first.agy), "stale");
  writeFileSync(staleCursorFile, "stale");
  writeFileSync(staleAgyFile, "stale");

  const second = await provisioner.provisionManagedRuntimes!(options);

  expect(second.cursor).toBe(first.cursor);
  expect(second.agy).toBe(first.agy);
  expect(existsSync(staleCursorFile)).toBe(false);
  expect(existsSync(staleAgyFile)).toBe(false);
});

it("rejects traversal members before extraction and preserves the installed runtime", async () => {
  expect(provisioner.provisionManagedRuntimes).toBeTypeOf("function");
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), "okami-runtime-provision-"),
  );
  const cursorDirectory = path.join(outputDirectory, "darwin-arm64", "cursor");
  const installedCursor = path.join(cursorDirectory, "cursor-agent");
  mkdirSync(cursorDirectory, { recursive: true });
  writeFileSync(installedCursor, "known-good");
  const cursorArchive = Buffer.from("malicious-cursor-archive");
  const extractArchive = vi.fn();

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
      antigravity: {
        version: "1.0.0",
        url: "https://official.example/agy.tar.gz",
        sha512: "0".repeat(128),
      },
      antigravityManifestUrl: "https://official.example/manifest.json",
      download: async () => cursorArchive,
      listArchive: async () => ["dist-package/cursor-agent", "../escaped"],
      extractArchive,
    }),
  ).rejects.toThrow("Cursor archive contains unsafe member ../escaped");
  expect(extractArchive).not.toHaveBeenCalled();
  expect(readFileSync(installedCursor, "utf8")).toBe("known-good");
  expect(existsSync(path.join(outputDirectory, "escaped"))).toBe(false);
});
