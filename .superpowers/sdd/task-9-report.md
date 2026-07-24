# Task 9 Report — PATH-clean packaged acceptance gate

## Status

DONE

Task 9 is implemented and verified against the real macOS arm64 application
bundle. Codex, Grok, Cursor, Antigravity, and OpenCode resolve only from the
OkamiCode app bundle or the verifier's isolated Okami user-data directory.
MiMo and MiniMax report Token Plan ownership with no executable. Claude is the
sole external executable.

No live model turn was sent. Every executable inspection used only
`--version`.

## RED

Command:

```text
pnpm vitest run scripts/verify-managed-runtime-package.test.ts
```

Observed result: exit 1.

Vitest failed to resolve the intentionally absent
`scripts/verify-managed-runtime-package.mjs`. No tests ran, which was the
expected missing-verifier RED.

## GREEN

Focused command:

```text
pnpm vitest run scripts/verify-managed-runtime-package.test.ts
```

Observed result: exit 0; 1 file passed, 4 tests passed.

The focused suite proves:

- a direct global path is rejected for a non-Claude runtime;
- an apparent in-bundle symlink that escapes the bundle is rejected by
  canonical `realpath`;
- app-bundle and Okami user-data ownership are accepted;
- MiMo and MiniMax have Token Plan ownership and no executable;
- only Claude may be marked external;
- executable proofs include absolute source paths and SHA-256 checksums.

## Real package

Command:

```text
pnpm package
```

The first sandboxed run built `release/mac-arm64/OkamiCode.app` but returned
exit 1 at DMG creation because `hdiutil` could not attach a device:
`hdiutil: create failed - Device not configured`.

The command was repeated once with macOS device access outside the sandbox.
Observed result: exit 0. It produced:

- `release/mac-arm64/OkamiCode.app`;
- `release/OkamiCode-v1.0.1-beta-macOS-arm64.dmg`;
- `release/OkamiCode-v1.0.1-beta-macOS-arm64.dmg.blockmap`.

The generated DMG is approximately 452 MB. The existing beta remains unsigned
and non-notarized, as documented.

## Real packaged verifier

Command:

```text
pnpm verify:managed-package release/mac-arm64/OkamiCode.app
```

Observed result after the successful package: exit 0 with JSON status `pass`.

| Provider | Version | Ownership | SHA-256 |
| --- | --- | --- | --- |
| Codex | `codex-cli 0.145.0` | `app-bundle` | `1da3f4e0e96028b8a771814293c3033dafd1971f943f6c7e79b0897fe705f590` |
| Grok | `grok 0.2.111 (94172f2aa4e5)` | `okami-user-data` | `e1fafdfffe14f339460befaf194360e8f90bfd02efe8a4f24cfa1c7aea657ffe` |
| Cursor | `2026.07.23-e383d2b` | `app-bundle` | `eed61c5224668c9236334c4c68936a16aecc37374b592f59e31eb50433817831` |
| Antigravity | `1.1.6` | `app-bundle` | `e82027374c14240cdfa55c312ee34c068bfe3918bd795b7cf857af8c005bfb4e` |
| OpenCode | `1.18.3` | `app-bundle` | `43f7083d450567706a80b6441331a25b5ed6d6c9f742826790545b068229cbb2` |
| MiMo | `not-applicable` | `token-plan` | none |
| MiniMax | `not-applicable` | `token-plan` | none |
| Claude | `2.1.218 (Claude Code)` | `external` | `71abaff59312c9a9b6a1d818365048b42e4e95cc521a823660eded3e0880d9b7` |

The JSON also reports each absolute executable source, transport,
entitlement, per-runtime status, bundle path, isolated user-data path, and
`minimalPath: "/usr/bin:/bin"`.

The version-probe environment is an allowlist containing only the minimal
system `PATH`, isolated `HOME`, system temporary directory, locale, `NO_COLOR`,
and `CI`. Provider credentials and the host environment are not inherited.

## Final regression gate

Packaging recompiles native modules for Electron. Before running the Node test
gate, the SQLite module was rebuilt for Node:

```text
pnpm rebuild better-sqlite3-multiple-ciphers
pnpm check
```

Observed result: exit 0.

- TypeScript project build: passed.
- ESLint with zero warnings: passed.
- Prettier check: passed.
- Vitest: 125 files passed, 4 skipped; 774 tests passed, 9 skipped.

The suite emitted the existing jsdom
`HTMLCanvasElement.getContext()` not-implemented warnings. They did not fail
the gate and are unrelated to Task 9.

## Implementation

- `verifyRuntimeOwnership` validates canonical filesystem ownership and
  executable permission, probes versions, calculates checksums, and returns a
  JSON-safe proof.
- `discoverPackagedRuntimes` locates the real Codex and OpenCode executables in
  `app.asar.unpacked`, Cursor and Antigravity in packaged managed resources,
  and the packaged compressed Grok artifact.
- Grok is materialized atomically into the isolated Okami user-data directory.
  A pre-existing divergent artifact fails closed.
- Claude discovery is the only host `PATH` lookup. Its version probe still
  runs with the clean environment and isolated `HOME`.
- MiMo and MiniMax never receive an executable source.
- README and both runtime architecture documents now identify Claude as the
  sole host executable exception.

## Files

- `.superpowers/sdd/task-9-report.md`
- `scripts/verify-managed-runtime-package.mjs`
- `scripts/verify-managed-runtime-package.test.ts`
- `package.json`
- `README.md`
- `docs/architecture/okami-runtime-sdk.md`
- `docs/architecture/runtime-harness-boundary.md`

The pre-existing modification to
`docs/superpowers/plans/2026-07-24-okami-runtime-sdk.md` was preserved and is
not part of the Task 9 commit.

## Concerns

None blocking.

The package remains unsigned and non-notarized. This is an existing beta
limitation, not a Task 9 regression.

## Critical and Important review follow-up

Status: RESOLVED.

The review correctly found that the first verifier proved a sidecar Grok path
while production `materializeGrok` trusted any pre-existing target, and that
the reported SHA-256 values were only observed rather than compared with an
expected package inventory.

### Runtime materialization RED

Command:

```text
pnpm exec vitest run src/main/runtime/managed-runtime.test.ts
```

Observed result: exit 1; 2 failed, 2 passed.

- A pre-existing Grok symlink escaping Okami runtime storage was returned.
- A pre-existing regular Grok file with divergent bytes was returned.

Both failures reproduced the production resolver path that supplies the
command later spawned by Electron.

### Runtime materialization GREEN

The runtime and package verifier now share
`materializeVerifiedArtifactSync`. It:

- canonicalizes the Okami runtime root and target directory;
- rejects a runtime root or target directory that is itself a symlink;
- rejects target-directory escape;
- uses `lstat` to reject symlinks and non-regular files;
- canonicalizes the final target and checks containment;
- compares SHA-256 against the official packaged/decompressed payload;
- uses exclusive temporary-file creation and atomic rename;
- returns no command when any check fails.

Focused result: exit 0; 1 file passed, 4 tests passed.

### Trust manifest and package-shaped fixture RED

Command:

```text
pnpm exec vitest run scripts/verify-managed-runtime-package.test.ts
```

Observed result: exit 1 because the trust-manifest generator and `afterPack`
hook did not yet exist.

### Trust manifest and package-shaped fixture GREEN

Command:

```text
pnpm exec vitest run src/main/runtime/managed-runtime.test.ts scripts/verify-managed-runtime-package.test.ts
```

Observed result after two fixture path/canonicalization corrections and the
runtime-root symlink hardening: exit 0; 2 files passed, 14 tests passed.

The package-shaped fixture uses the real macOS layout:

- `Contents/Resources/app.asar.unpacked` for Codex, Grok, and OpenCode;
- `Contents/Resources/managed-runtimes/darwin-arm64` for Cursor and
  Antigravity;
- Brotli-compressed Grok materialized through the same helper used by
  production;
- an external Claude executable;
- the real eight-provider trust manifest.

It proves successful discovery/materialization plus fail-closed behavior for a
missing trust manifest, missing provider, extra provider, and executable
tampering after manifest generation.

### Real afterPack and package proof

Command:

```text
pnpm package
```

Observed result: exit 0 on the first follow-up attempt. The real `.app`, DMG,
and blockmap were generated. `afterPack` wrote:

```text
release/mac-arm64/OkamiCode.app/Contents/Resources/managed-runtime-trust-manifest.json
```

The manifest contains exactly eight provider contracts:

- Codex, Grok materialized payload, Cursor, Antigravity, and OpenCode with
  expected SHA-256 values;
- MiMo and MiniMax with Token Plan ownership, no artifact, and no hash;
- Claude with external ownership, no packaged artifact, and no expected hash.

### Real verifier proof

Command:

```text
pnpm verify:managed-package release/mac-arm64/OkamiCode.app
```

Observed result: exit 0 and JSON status `pass`.

Every managed provider reports equal `checksum.value` and
`checksum.expected`. The trust manifest itself reports SHA-256
`27bb2fcc4b09cd7bd0107a1432ae092d61699b511c257e73333e62cb70091093`.
Claude remains the only external executable and has `expected: null`.

### Follow-up final regression

Packaging rebuilt the native modules for Electron, so the SQLite dependency
was restored for Node before the repository gate:

```text
pnpm rebuild better-sqlite3-multiple-ciphers
pnpm check
```

Observed result: exit 0.

- TypeScript project build: passed.
- ESLint with zero warnings: passed.
- Prettier check: passed.
- Vitest: 125 files passed, 4 skipped; 782 tests passed, 9 skipped.

No live provider turn ran in any follow-up gate.

### Follow-up files

- `.superpowers/sdd/task-9-report.md`
- `README.md`
- `docs/architecture/okami-runtime-sdk.md`
- `docs/architecture/runtime-harness-boundary.md`
- `electron-builder.yml`
- `scripts/generate-managed-runtime-trust-manifest.mjs`
- `scripts/verify-managed-runtime-package.mjs`
- `scripts/verify-managed-runtime-package.test.ts`
- `src/main/runtime/managed-artifact.d.mts`
- `src/main/runtime/managed-artifact.mjs`
- `src/main/runtime/managed-runtime.test.ts`
- `src/main/runtime/managed-runtime.ts`
