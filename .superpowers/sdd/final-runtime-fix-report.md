# Final runtime review fixes

Status: **DONE_WITH_CONCERNS**

No provider turn or live inference request was executed.

## Findings closed

- **C1 — atomic legacy binding migration**
  - `NativeSession` now carries an explicit authoritative migration signal with
    `fromNativeSessionId`, `toNativeSessionId`, and
    `rehydrationRequired: true`.
  - `ProviderRuntimeAdapter` starts a fresh Token Plan session for the
    provider-scoped retired MiMo/MiniMax CLI aliases. It does not call
    `resume()` with a CLI-native id.
  - schema migration 026 persists the migration source and one-shot
    rehydration state.
  - `LaneRepository.compareAndMigrateNativeSession()` verifies the
    provider-scoped retired alias and atomically updates only when the exact old
    binding still matches. `bindNativeSessionIfAbsentOrEqual()` remains strict.
  - integration coverage passes through the real `LaneService`,
    `LaneRepository`, and `ProviderRuntimeAdapter`.

- **I1 — explicit cold Token Plan handoff**
  - a migrated lane is forced cold even when native and conversation cursors
    were fully advanced.
  - the first accepted Token Plan turn receives bounded full persisted Okami
    context, including historical user and assistant messages from the same
    lane.
  - the persisted rehydration marker survives reopen and is acknowledged only
    after `RunService.sendTurn()` accepts the delta. Later turns do not replay
    the handoff.
  - MiMo Responses and MiniMax Chat Completions are both covered without a
    provider call.

- **I2 — development bootstrap**
  - packaged startup resolves `process.resourcesPath`.
  - development startup resolves `<appPath>/.cache`, matching the provisioner
    layout `.cache/managed-runtimes/<target>`.
  - package/dev resolver tests pass and the README source workflow now includes
    `pnpm provision:runtimes`.

- **I3 — optional external Claude**
  - absent Claude is reported as `external/unavailable` with no version probe.
  - `--claude <executable>` remains the explicit optional probe.
  - external non-Claude executables remain fatal.

- **M1 — product contract attestation**
  - verifier transport and entitlement contracts are derived from
    `builtInRuntimeManifests`, not a second hard-coded transport catalog.
  - the derived managed-provider set is cross-checked against the resolved
    packaged inventory before acceptance.

- **M2 — isolated verifier HOME**
  - default user-data is created with `mkdtemp()` and removed recursively in
    `finally`, on success or failure.
  - explicit `--user-data` is preserved for debugging.

## TDD evidence

- C1/I1 RED: 5 expected failures across provider router, repository CAS, and
  LaneService integration.
- C1/I1 GREEN: third focused validation, 33/33 tests.
- I2 RED: 2 expected missing-resolver failures.
- I2 GREEN: first implementation validation, 7/7 tests.
- I3/M1/M2 RED: 3 expected failures.
- I3/M1/M2 GREEN: second implementation validation, 12/12 tests.
- No validation loop exceeded three attempts.

## Final gates

- `pnpm vitest run src/main/runtime/sdk/provider-runtime.test.ts src/main/runtime/sdk/responses-transport.test.ts src/main/runtime/sdk/chat-completions-transport.test.ts src/main/db/repositories/lanes.test.ts src/main/orchestration/lane-service.test.ts src/main/runtime/managed-runtime.test.ts src/main/runtime/manifest.test.ts src/main/runtime/registry.test.ts src/main/runtime/commands.test.ts scripts/provision-managed-runtimes.test.ts scripts/verify-managed-runtime-package.test.ts`
  - exit 0; 11 files, 79/79 tests.
- `pnpm typecheck`
  - exit 0 on the third validation.
- `pnpm package`
  - exit 1 while creating the DMG only:
    `hdiutil: create failed - Device not configured`.
  - provisioning, native Electron rebuild, production builds, `.app`
    packaging, and `afterPack` trust-manifest generation completed before the
    environmental DMG failure.
- `pnpm verify:managed-package release/mac-arm64/OkamiCode.app`
  - exit 0 against the real packaged app.
  - Codex, Grok, Cursor, Antigravity, and OpenCode checksums matched.
  - MiMo and MiniMax passed as Token Plan/no executable.
  - Claude passed as `external/unavailable` without a probe.
- `pnpm rebuild better-sqlite3-multiple-ciphers`
  - exit 0 for Node 24.17.0 after Electron packaging.
- `pnpm check`
  - exit 0 on the third validation.
  - typecheck, lint, and format passed.
  - 125 test files passed, 4 skipped; 790 tests passed, 9 skipped.

## Concern

The only incomplete artifact is the DMG container. The real `.app` and its
runtime trust proof are valid; this environment could not attach/configure the
disk-image device required by `hdiutil`. No code or runtime-integrity failure
was observed.
