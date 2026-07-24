import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { builtInRuntimeManifests } from "../src/main/runtime/manifest";

const verifier = await import("./verify-managed-runtime-package.mjs").catch(
  () => ({ verifyRuntimeOwnership: undefined }),
);
const trustGenerator =
  await import("./generate-managed-runtime-trust-manifest.mjs").catch(() => ({
    generateManagedRuntimeTrustManifest: undefined,
  }));

const TRUST_MANIFEST_NAME = "managed-runtime-trust-manifest.json";

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

  it("reports absent Claude as external and unavailable without probing it", async () => {
    expect(verifier.verifyRuntimeOwnership).toBeTypeOf("function");
    const fixture = await createPackageFixture();
    let probes = 0;

    const proof = await verifier.verifyRuntimeOwnership!({
      appPath: fixture.appPath,
      userDataDirectory: fixture.userDataDirectory,
      runtimes: [
        {
          provider: "claude",
          transport: "claude-cli",
          entitlement: "subscription",
          source: null,
          external: true,
          unavailable: true,
        },
      ],
      execute: async () => {
        probes += 1;
        return { stdout: "must-not-run", stderr: "" };
      },
    });

    expect(probes).toBe(0);
    expect(proof.runtimes).toEqual([
      {
        provider: "claude",
        transport: "claude-cli",
        entitlement: "subscription",
        version: null,
        source: null,
        checksum: null,
        ownership: "external",
        status: "unavailable",
      },
    ]);
  });

  it("derives verifier transport and entitlement contracts from shipped runtime manifests", () => {
    expect(verifier.deriveProviderContracts).toBeTypeOf("function");
    const contracts = verifier.deriveProviderContracts!(
      builtInRuntimeManifests,
    );

    expect(
      contracts.map(
        (entry: {
          provider: string;
          transport: string;
          entitlement: string;
        }) => ({
          provider: entry.provider,
          transport: entry.transport,
          entitlement: entry.entitlement,
        }),
      ),
    ).toEqual(
      Object.values(builtInRuntimeManifests).map((manifest) => ({
        provider: manifest.runtimeId,
        transport: manifest.transports[0].id,
        entitlement: manifest.transports[0].entitlement,
      })),
    );

    const drifted = structuredClone(builtInRuntimeManifests) as {
      mimo: { transports: Array<{ id: string }> };
      [provider: string]: unknown;
    };
    drifted.mimo.transports[0].id = "mimo-token-plan-v2";
    expect(
      verifier.deriveProviderContracts!(drifted).find(
        (entry: { provider: string }) => entry.provider === "mimo",
      ).transport,
    ).toBe("mimo-token-plan-v2");
  });

  it("discovers and verifies a package-shaped fixture through its generated trust manifest", async () => {
    expect(trustGenerator.generateManagedRuntimeTrustManifest).toBeTypeOf(
      "function",
    );
    expect(verifier.verifyManagedRuntimePackage).toBeTypeOf("function");
    const fixture = await createPackageShapedFixture();

    const trust = await trustGenerator.generateManagedRuntimeTrustManifest!({
      appPath: fixture.appPath,
    });
    const proof = await verifier.verifyManagedRuntimePackage!({
      appPath: fixture.appPath,
      userDataDirectory: fixture.userDataDirectory,
      claudeSource: fixture.claudeSource,
    });

    expect(
      trust.providers.map((entry: { provider: string }) => entry.provider),
    ).toEqual([
      "claude",
      "codex",
      "cursor",
      "agy",
      "grok",
      "mimo",
      "minimax",
      "opencode",
    ]);
    expect(proof.status).toBe("pass");
    expect(proof.trustManifest).toMatchObject({
      source: await realpath(
        path.join(fixture.resourcesDirectory, TRUST_MANIFEST_NAME),
      ),
      checksum: {
        algorithm: "sha256",
        value: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(
      proof.runtimes.find(
        (entry: { provider: string }) => entry.provider === "grok",
      ),
    ).toMatchObject({
      ownership: "okami-user-data",
      checksum: {
        value: trust.providers.find(
          (entry: { provider: string }) => entry.provider === "grok",
        ).sha256,
        expected: trust.providers.find(
          (entry: { provider: string }) => entry.provider === "grok",
        ).sha256,
      },
    });
  });

  it("cleans default temporary verifier user-data but preserves explicit user-data", async () => {
    expect(trustGenerator.generateManagedRuntimeTrustManifest).toBeTypeOf(
      "function",
    );
    expect(verifier.verifyManagedRuntimePackage).toBeTypeOf("function");
    const fixture = await createPackageShapedFixture();
    await trustGenerator.generateManagedRuntimeTrustManifest!({
      appPath: fixture.appPath,
    });

    const temporaryProof = await verifier.verifyManagedRuntimePackage!({
      appPath: fixture.appPath,
    });
    await expect(stat(temporaryProof.userDataDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });

    await verifier.verifyManagedRuntimePackage!({
      appPath: fixture.appPath,
      userDataDirectory: fixture.userDataDirectory,
    });
    await expect(stat(fixture.userDataDirectory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });

  it("rejects a packaged executable modified after trust-manifest generation", async () => {
    expect(trustGenerator.generateManagedRuntimeTrustManifest).toBeTypeOf(
      "function",
    );
    expect(verifier.verifyManagedRuntimePackage).toBeTypeOf("function");
    const fixture = await createPackageShapedFixture();
    await trustGenerator.generateManagedRuntimeTrustManifest!({
      appPath: fixture.appPath,
    });
    await createExecutable(fixture.cursorSource, "tampered-cursor");

    await expect(
      verifier.verifyManagedRuntimePackage!({
        appPath: fixture.appPath,
        userDataDirectory: fixture.userDataDirectory,
        claudeSource: fixture.claudeSource,
      }),
    ).rejects.toThrow(/cursor.*SHA-256 mismatch/iu);
  });

  it("requires the packaged trust manifest", async () => {
    expect(verifier.verifyManagedRuntimePackage).toBeTypeOf("function");
    const fixture = await createPackageShapedFixture();

    await expect(
      verifier.verifyManagedRuntimePackage!({
        appPath: fixture.appPath,
        userDataDirectory: fixture.userDataDirectory,
        claudeSource: fixture.claudeSource,
      }),
    ).rejects.toThrow(/managed runtime trust manifest.*missing/iu);
  });

  it.each([
    {
      label: "missing",
      mutate: (providers: unknown[]) => providers.slice(1),
      expected: /trust manifest.*missing.*claude/iu,
    },
    {
      label: "extra",
      mutate: (providers: unknown[]) => [
        ...providers,
        {
          provider: "unexpected",
          transport: "unexpected",
          entitlement: "subscription",
          ownership: "app-bundle",
          artifact: "unexpected",
          artifactEncoding: "identity",
          sha256: "0".repeat(64),
        },
      ],
      expected: /trust manifest.*unexpected.*provider/iu,
    },
  ])(
    "rejects a trust manifest with $label providers",
    async ({ mutate, expected }) => {
      expect(trustGenerator.generateManagedRuntimeTrustManifest).toBeTypeOf(
        "function",
      );
      expect(verifier.verifyManagedRuntimePackage).toBeTypeOf("function");
      const fixture = await createPackageShapedFixture();
      await trustGenerator.generateManagedRuntimeTrustManifest!({
        appPath: fixture.appPath,
      });
      const manifestPath = path.join(
        fixture.resourcesDirectory,
        TRUST_MANIFEST_NAME,
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.providers = mutate(manifest.providers);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      await expect(
        verifier.verifyManagedRuntimePackage!({
          appPath: fixture.appPath,
          userDataDirectory: fixture.userDataDirectory,
          claudeSource: fixture.claudeSource,
        }),
      ).rejects.toThrow(expected);
    },
  );
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

async function createPackageShapedFixture(): Promise<{
  appPath: string;
  resourcesDirectory: string;
  userDataDirectory: string;
  claudeSource: string;
  cursorSource: string;
}> {
  const fixture = await createPackageFixture();
  const unpacked = path.join(
    fixture.resourcesDirectory,
    "app.asar.unpacked",
    "node_modules",
  );
  const managed = path.join(
    fixture.resourcesDirectory,
    "managed-runtimes",
    "darwin-arm64",
  );
  await createExecutable(
    path.join(
      unpacked,
      "@openai",
      "codex-darwin-arm64",
      "vendor",
      "aarch64-apple-darwin",
      "bin",
      "codex",
    ),
    "codex-cli fixture",
  );
  const grokPayload = Buffer.from("#!/bin/sh\nprintf '%s\\n' 'grok fixture'\n");
  const grokCompressed = path.join(
    unpacked,
    "@xai-official",
    "grok-darwin-arm64",
    "bin",
    "grok.br",
  );
  await mkdir(path.dirname(grokCompressed), { recursive: true });
  await writeFile(grokCompressed, brotliCompressSync(grokPayload));
  const cursorSource = await createExecutable(
    path.join(managed, "cursor", "cursor-agent"),
    "cursor fixture",
  );
  await createExecutable(path.join(managed, "agy", "agy"), "agy fixture");
  await createExecutable(
    path.join(unpacked, "opencode-darwin-arm64", "bin", "opencode"),
    "opencode fixture",
  );
  const claudeSource = await createExecutable(
    path.join(fixture.root, "external", "claude"),
    "claude fixture",
  );
  return {
    ...fixture,
    claudeSource,
    cursorSource,
  };
}
