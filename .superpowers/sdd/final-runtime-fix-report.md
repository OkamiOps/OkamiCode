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

---

## Final rereview — completion-aware acceptance and restart recovery

Status: **DONE_WITH_CONCERNS**

No provider turn or live inference request was executed.

### Findings closed

- **C1 — acceptance only after persisted completion**
  - `RunService` and `LaneService` no longer advance native-event cursors,
    conversation cursors, or rehydration acknowledgement when a `RunHandle` is
    allocated.
  - a shared completion-aware event wrapper commits those projections only
    after the matching `run_completed` event has been consumed by the IPC
    forwarding loop; at that point the event and terminal run status have
    already been persisted and forwarded.
  - `run_failed`, `run_cancelled`, generator errors, and stream/process death
    leave the marker and cursors unchanged, so the handoff remains replayable.
  - real MiMo Responses failure and MiniMax cancellation integration tests pass
    through `LaneService` and the IPC forwarding path, then reopen the database
    and verify the lane remains cold.

- **I1 — restart-aware Token Plan rehydration**
  - MiMo Responses and MiniMax Chat Completions preserve native continuation
    only while the same adapter instance owns the in-memory state.
  - after adapter reconstruction, `resume()` signals
    `transport_continuation_unavailable`.
  - `LaneService` marks only the exact current native-session binding
    `rehydration_required`, via repository compare-and-set, and sends bounded
    full persisted Okami context again.
  - same-process resume remains native and does not force an unnecessary
    replay.

- **M1 — verifier transport ownership**
  - verifier contracts now derive every transport in each shipped runtime
    manifest.
  - trust and runtime inventories are keyed by provider plus transport, so a
    provider may own multiple transports without collapsing their artifact
    contracts.
  - the current one-transport-per-provider package remains valid.

### TDD evidence

- RED: 9 expected failures across completion acknowledgement, CAS restart
  state, adapter reconstruction, and multi-transport verifier derivation.
- GREEN: 6 focused files, 48/48 tests.
- real IPC forwarding integration: 2/2 tests for MiMo failure and MiniMax
  cancellation, including reopen behavior and full-context request assertions.
- no focused validation loop exceeded three attempts.

### Final gates

- `pnpm package`
  - exit 1 only at DMG creation:
    `hdiutil: create failed - Device not configured`.
  - provisioning, native Electron rebuild, production builds, `.app`
    packaging, and trust-manifest generation completed.
- `pnpm verify:managed-package release/mac-arm64/OkamiCode.app`
  - exit 0 against the newly packaged real app; all checksum, ownership, Token
    Plan, and external-Claude contracts passed.
- `pnpm rebuild better-sqlite3-multiple-ciphers`
  - exit 0 for Node 24.17.0 after Electron packaging.
- `pnpm check`
  - attempt 1 reached typecheck and exposed test-only branded-id/mock typing;
    fixed.
  - attempt 2 passed typecheck and exposed four test-only lint errors; fixed.
  - attempt 3 passed typecheck and lint, then exposed Prettier changes in three
    modified tests. Those files were formatted mechanically, but the gate was
    not run a fourth time because the requested three-attempt limit was
    reached.

### Remaining concern

The implementation and focused acceptance suite are green, and the real `.app`
trust proof passes. The full `pnpm check` is not recorded green after the final
mechanical formatting correction because doing so would exceed the explicit
three-attempt validation cap. The DMG environment failure is unchanged.
