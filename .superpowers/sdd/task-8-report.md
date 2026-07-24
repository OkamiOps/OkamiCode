# Task 8 Report — Remove every non-Claude host CLI route

## Status

DONE_WITH_CONCERNS

Task 8 is implemented. Production host discovery is confined to Claude.
Codex, Grok, Cursor, Antigravity, and OpenCode consume absolute managed
commands. MiMo and MiniMax register only their Token Plan HTTP transports,
which own legacy sessions so persisted Okami lane context resumes through the
HTTP transport.

## RED

Command:

```text
pnpm test -- src/main/runtime/registry.test.ts src/main/runtime/manifest.test.ts src/main/runtime/commands.test.ts src/main/runtime/model-catalog.test.ts src/main/usage/service.test.ts
```

Observed result: exit 1.

- 5 test files failed.
- 6 behavioral tests failed.
- `resolveRuntimeCommands` still returned MiMo and MiniMax host commands.
- MiMo and MiniMax manifests still advertised CLI candidates and did not make
  the Token Plan HTTP candidate the legacy-session owner.
- The model catalog still called the host locator for MiMo and MiniMax.
- The usage service still called the host locator for Codex.

## GREEN

Focused command:

```text
pnpm exec vitest run src/main/runtime/registry.test.ts src/main/runtime/manifest.test.ts src/main/runtime/commands.test.ts src/main/runtime/model-catalog.test.ts src/main/usage/service.test.ts
```

Observed result: exit 0, 5 files passed, 30 tests passed.

Expanded runtime/usage regression:

```text
pnpm exec vitest run src/main/runtime src/main/usage src/main/ecosystem/cli-capabilities.test.ts src/main/ipc/handlers.test.ts
```

Observed result after one fixture-contract correction: exit 0, 44 files
passed, 4 skipped; 264 tests passed, 9 skipped.

Full suite:

```text
pnpm exec vitest run --reporter=dot
```

Observed result: exit 0, 124 files passed, 4 skipped; 764 tests passed,
9 skipped.

Final constituent gates:

```text
pnpm typecheck
pnpm lint
pnpm format:check
```

Observed result: all exit 0.

Static production boundary:

```text
rg -n "locateLocalBinary\\(" src/main --glob '!**/*.test.ts'
```

Observed result: the only call sites are Claude-specific:

- the safe default in `createCliCapabilityDetector`;
- the Claude usage collector.

The exported `locateLocalBinary` declaration itself also appears in the
search, but is not a call site.

## Implementation

- `resolveRuntimeCommands` now returns Claude plus the complete
  `ManagedRuntimeCommands` set and invokes the locator only with `claude`.
- The MiMo and MiniMax manifests each contain exactly one Token Plan HTTP
  transport with `legacySessionOwner: true`.
- The runtime registry requires and registers the MiMo Responses transport and
  MiniMax Chat Completions transport; it no longer imports or constructs their
  CLI adapters.
- Bootstrap injects managed paths into runtime adapters, the model catalog,
  usage collectors, AGY companion provisioning, and capability detection.
- Model catalog construction never discovers host binaries. MiMo and MiniMax
  catalogs come only from configured Okami HTTP catalogs.
- Non-Claude usage collectors do not discover host commands. The usage service
  receives managed commands and no longer instantiates the MiniMax CLI quota
  collector.
- Default capability detection refuses non-Claude host discovery.

## Files

- `.superpowers/sdd/task-8-report.md`
- `src/main/ecosystem/cli-capabilities.ts`
- `src/main/index.ts`
- `src/main/ipc/handlers.ts`
- `src/main/runtime/commands.ts`
- `src/main/runtime/commands.test.ts`
- `src/main/runtime/manifest.ts`
- `src/main/runtime/manifest.test.ts`
- `src/main/runtime/model-catalog.ts`
- `src/main/runtime/model-catalog.test.ts`
- `src/main/runtime/registry.ts`
- `src/main/runtime/registry.test.ts`
- `src/main/usage/agy-collector.ts`
- `src/main/usage/collectors.test.ts`
- `src/main/usage/cursor-collector.ts`
- `src/main/usage/grok-collector.ts`
- `src/main/usage/minimax-collector.ts`
- `src/main/usage/service.ts`
- `src/main/usage/service.test.ts`

The pre-existing modification to
`docs/superpowers/plans/2026-07-24-okami-runtime-sdk.md` was preserved and is
not part of the Task 8 commit.

## Commit

Planned isolated commit:

```text
fix(runtime): remove non-Claude host CLI routes
```

The final SHA is returned with the task handoff because a commit cannot contain
its own SHA.

## Concerns

- `pnpm check` was invoked three times. Each captured typecheck, lint, and
  format success and started Vitest, but the execution harness closed the cell
  before returning the Vitest footer or wrapper exit status. To avoid claiming
  an unobserved pass, every constituent gate was rerun directly and returned
  exit 0, including the full 773-test Vitest suite (764 passed, 9 skipped).
- Existing renderer tests emit unrelated `HTMLCanvasElement.getContext` and
  PressResponder warnings. They do not fail the suite and were not changed in
  this task.
