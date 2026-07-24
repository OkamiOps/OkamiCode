import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const verifier = await import("./verify-managed-runtime-package.mjs").catch(
  () => ({ verifyRuntimeOwnership: undefined }),
);

interface RuntimeFixture {
  provider: string;
  transport: string;
  entitlement: "subscription" | "token_plan" | "provider_managed";
  source: string | null;
  versionArgs?: string[];
}

describe("managed runtime package verifier", () => {
  it("rejects a non-Claude runtime resolved from a global path", async () => {
    expect(verifier.verifyRuntimeOwnership).toBeTypeOf("function");
    const fixture = await createPackageFixture();
    const globalCodex = await createExecutable(
      path.join(fixture.root, "global", "codex"),
      "codex-cli 999.0.0",
    );

    await expect(
      verifier.verifyRuntimeOwnership!({
        appPath: fixture.appPath,
        userDataDirectory: fixture.userDataDirectory,
        runtimes: [executableRuntime("codex", "codex-managed", globalCodex)],
      }),
    ).rejects.toThrow(
      /codex.*outside the OkamiCode app bundle and user-data directory/iu,
    );
  });

  it("rejects an apparent bundle executable whose symlink escapes the app", async () => {
    expect(verifier.verifyRuntimeOwnership).toBeTypeOf("function");
    const fixture = await createPackageFixture();
    const globalOpenCode = await createExecutable(
      path.join(fixture.root, "global", "opencode"),
      "1.18.3",
    );
    const disguisedOpenCode = path.join(
      fixture.resourcesDirectory,
      "managed-runtimes",
      "darwin-arm64",
      "opencode",
    );
    await mkdir(path.dirname(disguisedOpenCode), { recursive: true });
    await symlink(globalOpenCode, disguisedOpenCode);

    await expect(
      verifier.verifyRuntimeOwnership!({
        appPath: fixture.appPath,
        userDataDirectory: fixture.userDataDirectory,
        runtimes: [
          executableRuntime("opencode", "opencode-acp", disguisedOpenCode),
        ],
      }),
    ).rejects.toThrow(
      /opencode.*outside the OkamiCode app bundle and user-data directory/iu,
    );
  });

  it("accepts managed executables, Token Plans, and only Claude as external", async () => {
    expect(verifier.verifyRuntimeOwnership).toBeTypeOf("function");
    const fixture = await createPackageFixture();
    const bundleBin = path.join(
      fixture.resourcesDirectory,
      "managed-runtimes",
      "darwin-arm64",
    );
    const userDataBin = path.join(
      fixture.userDataDirectory,
      "managed-runtimes",
      "grok",
      "darwin-arm64",
    );
    const externalBin = path.join(fixture.root, "external");
    const runtimes: RuntimeFixture[] = [
      executableRuntime(
        "codex",
        "codex-managed",
        await createExecutable(
          path.join(bundleBin, "codex", "codex"),
          "codex-cli 0.145.0",
        ),
      ),
      executableRuntime(
        "grok",
        "grok-managed",
        await createExecutable(path.join(userDataBin, "grok"), "grok 0.2.111"),
      ),
      executableRuntime(
        "cursor",
        "cursor-agent",
        await createExecutable(
          path.join(bundleBin, "cursor", "cursor-agent"),
          "2026.07.23-e383d2b",
        ),
      ),
      executableRuntime(
        "agy",
        "agy-cli",
        await createExecutable(path.join(bundleBin, "agy", "agy"), "1.1.6"),
      ),
      executableRuntime(
        "opencode",
        "opencode-acp",
        await createExecutable(
          path.join(bundleBin, "opencode", "opencode"),
          "1.18.3",
        ),
      ),
      tokenPlanRuntime("mimo", "mimo-token-plan"),
      tokenPlanRuntime("minimax", "minimax-token-plan"),
      {
        ...executableRuntime(
          "claude",
          "claude-cli",
          await createExecutable(
            path.join(externalBin, "claude"),
            "2.1.218 (Claude Code)",
          ),
        ),
        external: true,
      },
    ];

    const proof = await verifier.verifyRuntimeOwnership!({
      appPath: fixture.appPath,
      userDataDirectory: fixture.userDataDirectory,
      runtimes,
    });

    expect(proof).toMatchObject({
      schemaVersion: 1,
      status: "pass",
      minimalPath: "/usr/bin:/bin",
    });
    expect(proof.runtimes).toHaveLength(8);
    expect(
      proof.runtimes.filter(
        (entry: { ownership: string }) => entry.ownership === "external",
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "claude",
        version: "2.1.218 (Claude Code)",
        status: "pass",
      }),
    ]);
    expect(
      proof.runtimes.filter(
        (entry: { ownership: string }) => entry.ownership === "token-plan",
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "mimo",
        source: null,
        checksum: null,
      }),
      expect.objectContaining({
        provider: "minimax",
        source: null,
        checksum: null,
      }),
    ]);
    expect(
      proof.runtimes
        .filter(
          (entry: { ownership: string }) =>
            entry.ownership === "app-bundle" ||
            entry.ownership === "okami-user-data",
        )
        .every(
          (entry: {
            source: string;
            checksum: { algorithm: string; value: string };
          }) =>
            path.isAbsolute(entry.source) &&
            entry.checksum.algorithm === "sha256" &&
            /^[a-f0-9]{64}$/u.test(entry.checksum.value),
        ),
    ).toBe(true);
  });

  it("refuses to label any provider except Claude as external", async () => {
    expect(verifier.verifyRuntimeOwnership).toBeTypeOf("function");
    const fixture = await createPackageFixture();
    const externalCursor = await createExecutable(
      path.join(fixture.root, "external", "cursor-agent"),
      "999.0.0",
    );

    await expect(
      verifier.verifyRuntimeOwnership!({
        appPath: fixture.appPath,
        userDataDirectory: fixture.userDataDirectory,
        runtimes: [
          {
            ...executableRuntime("cursor", "cursor-agent", externalCursor),
            external: true,
          },
        ],
      }),
    ).rejects.toThrow(/only Claude may be external/iu);
  });
});

function executableRuntime(
  provider: string,
  transport: string,
  source: string,
): RuntimeFixture {
  return {
    provider,
    transport,
    entitlement: "subscription",
    source,
    versionArgs: ["--version"],
  };
}

function tokenPlanRuntime(provider: string, transport: string): RuntimeFixture {
  return {
    provider,
    transport,
    entitlement: "token_plan",
    source: null,
  };
}

async function createPackageFixture(): Promise<{
  root: string;
  appPath: string;
  resourcesDirectory: string;
  userDataDirectory: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "okami-package-verifier-"));
  const appPath = path.join(root, "release", "OkamiCode.app");
  const resourcesDirectory = path.join(appPath, "Contents", "Resources");
  const userDataDirectory = path.join(root, "user-data");
  await mkdir(resourcesDirectory, { recursive: true });
  await mkdir(userDataDirectory, { recursive: true });
  return { root, appPath, resourcesDirectory, userDataDirectory };
}

async function createExecutable(
  executablePath: string,
  version: string,
): Promise<string> {
  await mkdir(path.dirname(executablePath), { recursive: true });
  await writeFile(
    executablePath,
    `#!/bin/sh\nprintf '%s\\n' '${version.replaceAll("'", "")}'\n`,
  );
  await chmod(executablePath, 0o755);
  return executablePath;
}
