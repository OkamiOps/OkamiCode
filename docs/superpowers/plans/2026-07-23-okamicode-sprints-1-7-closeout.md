# OkamiCode Sprints 1–7 Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the runtime, context, telemetry, validation, documentation, and distribution work promised in sprints 1–7 as one visually polished and functionally verified OkamiCode beta.

**Architecture:** Keep provider-native harnesses behind one canonical event contract. Use OpenCode through its official ACP transport, use `cursor-agent` directly for Cursor, and adopt BB's useful thread/handoff ideas without embedding a second competing IDE or adding BB as a runtime dependency. Share only bounded, sanitized task state across lanes and never spend a model call merely to compact context.

**Tech Stack:** Electron 43, TypeScript 6, React 19, Zod 4, encrypted SQLite, Vitest, Playwright Electron, provider CLIs, ACP SDK 0.21.

## Global Constraints

- Preserve all existing projects, messages, native-session bindings, credentials, and worktree references.
- Never fabricate token, quota, context-window, or capability data.
- Do not add a paid API fallback or silently switch providers.
- Keep runtime-specific behavior inside adapters and canonical projections.
- Use deterministic local compaction only; `modelCalls` must remain `0`.
- Use RED → GREEN for every behavior change.
- Reuse the current Okami visual tokens and components.
- Validate Electron visually at 1440×900 and at the existing responsive breakpoints.
- The release gate is `pnpm check`, `pnpm test:e2e`, a packaged DMG, and the provider conformance gate.

---

### Task 1: Make Runtime Capabilities Truthful and Single-Sourced

**Files:**
- Modify: `src/main/runtime/manifest.ts`
- Modify: `src/main/runtime/registry.ts`
- Modify: `src/main/runtime/manifest.test.ts`
- Modify: `src/main/runtime/registry.test.ts`
- Modify: `src/main/ecosystem/cli-capabilities.ts`
- Modify: `src/main/ecosystem/cli-capabilities.test.ts`

**Interfaces:**
- Consumes: `RuntimeAdapter`, `RuntimeManifest`, `RuntimeHealth`.
- Produces: `RuntimeRegistry.health(kind)`, `RuntimeRegistry.healthAll()`, and one truthful manifest per registered runtime.

- [ ] **Step 1: Write failing capability and registry-health tests**

```ts
it("advertises usage only when the adapter emits canonical usage", () => {
  expect(builtInRuntimeManifests.cursor.capabilities).toContain("usage");
  expect(builtInRuntimeManifests.mimo.capabilities).toContain("usage");
  expect(builtInRuntimeManifests.minimax.capabilities).toContain("usage");
});

it("reports health for every registered runtime from the same registry", async () => {
  expect(await registry.healthAll()).toHaveLength(registry.manifests().length);
});
```

- [ ] **Step 2: Run the focused tests and verify the expected RED**

Run: `pnpm vitest run src/main/runtime/manifest.test.ts src/main/runtime/registry.test.ts src/main/ecosystem/cli-capabilities.test.ts`

Expected: FAIL because usage capabilities and registry health are incomplete.

- [ ] **Step 3: Implement the minimal single-source capability contract**

Add `usage` to manifests only for adapters that emit `usage_reported`; add registry health methods that call the registered adapter's `detect()`; make CLI capability projection consume the matching manifest rather than a second hard-coded empty list.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm vitest run src/main/runtime/manifest.test.ts src/main/runtime/registry.test.ts src/main/ecosystem/cli-capabilities.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit sprint 1**

```bash
git add src/main/runtime src/main/ecosystem
git commit -m "fix: make runtime capabilities authoritative"
```

### Task 2: Close OpenCode ACP and Record the BB Boundary

**Files:**
- Modify: `src/main/runtime/opencode/adapter.test.ts`
- Modify: `src/main/runtime/subscription-live.test.ts`
- Modify: `src/main/runtime/model-catalog.test.ts`
- Modify: `src/main/runtime/model-catalog.ts`
- Create: `docs/architecture/runtime-harness-boundary.md`
- Modify: `README.md`
- Modify: `README.pt-BR.md`

**Interfaces:**
- Consumes: official OpenCode ACP session/update/permission protocol.
- Produces: selectable OpenCode runtime, visible ACP health, and a documented decision that BB is a reference for steerable threads/handoffs—not an embedded runtime.

- [ ] **Step 1: Write failing OpenCode catalog and conformance tests**

```ts
it("shows OpenCode only when ACP is verified", async () => {
  expect(await catalogWith({ opencodeAcp: false })).not.toContainRuntime("opencode");
  expect(await catalogWith({ opencodeAcp: true })).toContainRuntime("opencode");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run src/main/runtime/opencode/adapter.test.ts src/main/runtime/model-catalog.test.ts`

Expected: FAIL if catalog readiness does not follow ACP health.

- [ ] **Step 3: Implement only the missing ACP readiness behavior**

Keep the existing adapter and permission bridge; remove any model entry that claims readiness without `opencode acp` being detected.

- [ ] **Step 4: Document the BB decision with primary-source links**

Record three adopted patterns: steerable persistent threads, explicit agent handoff, and provider-CLI reuse. Record three rejected choices: embedding BB, running a second orchestrator, and adding BB telemetry/runtime state to OkamiCode.

- [ ] **Step 5: Run fixture conformance and the opt-in OpenCode live smoke**

Run: `pnpm vitest run src/main/runtime/opencode/adapter.test.ts src/main/runtime/model-catalog.test.ts`

Live run: `OKAMI_RUN_LIVE_CLI_TESTS=1 OKAMI_RUN_OPENCODE_LIVE_TESTS=1 pnpm vitest run src/main/runtime/subscription-live.test.ts -t OpenCode`

Expected: fixture tests PASS; live test returns `OKAMI_OPENCODE_SMOKE` or records an honest environment/authentication failure.

- [ ] **Step 6: Commit sprint 2**

```bash
git add src/main/runtime docs/architecture README.md README.pt-BR.md
git commit -m "docs: close OpenCode and BB harness boundary"
```

### Task 3: Transfer Useful Task State Across Providers

**Files:**
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/ipc/lane-ipc.test.ts`
- Modify: `src/main/orchestration/delta.ts`
- Modify: `src/main/orchestration/lane-service.test.ts`
- Modify: `src/main/orchestration/context-compiler.ts`
- Modify: `src/main/orchestration/context-compiler.test.ts`

**Interfaces:**
- Consumes: canonical assistant, tool-completion, approval, and failure events.
- Produces: bounded `conversation` entries with roles `user`, `assistant`, and `context`, deduplicated per target/source lane.

- [ ] **Step 1: Write failing cross-provider handoff tests**

```ts
it("hands a sibling lane the completed tool, failure and approval summaries once", async () => {
  expect(firstTurn.input).toContain("Arquivos alterados");
  expect(firstTurn.input).toContain("Aprovação");
  expect(secondTurn.input).not.toContain("Arquivos alterados");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/main/ipc/lane-ipc.test.ts src/main/orchestration/lane-service.test.ts src/main/orchestration/context-compiler.test.ts`

Expected: FAIL because only user/assistant text is shared.

- [ ] **Step 3: Persist sanitized context entries**

Persist concise context messages only for `tool_call_completed`, `approval_resolved`, and `run_failed`. Store no raw environment, authorization header, full terminal output, or provider credential. Reuse the existing per-source cursor so each target receives each entry once.

- [ ] **Step 4: Pack context entries by priority**

Compile in this order: objective and constraints, decisions/Git, latest user and assistant turns, failure/approval summaries, tool summaries, then older messages. Never cut a message in the middle.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/main/ipc/lane-ipc.test.ts src/main/orchestration/lane-service.test.ts src/main/orchestration/context-compiler.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit sprint 3**

```bash
git add src/main/ipc src/main/orchestration
git commit -m "feat: hand off task state across providers"
```

### Task 4: Replace Raw Truncation with Deterministic Compaction

**Files:**
- Modify: `src/main/orchestration/context-compiler.ts`
- Modify: `src/main/orchestration/context-compiler.test.ts`
- Modify: `src/main/orchestration/run-service.test.ts`

**Interfaces:**
- Consumes: prioritized delta entries and `ContextBudget`.
- Produces: `CompiledContext` with exact entry counts, estimated savings, deterministic fingerprint, and `modelCalls: 0`.

- [ ] **Step 1: Write failing whole-entry compaction tests**

```ts
it("drops the oldest low-priority entries without slicing authoritative text", () => {
  expect(result.content).not.toContain("[contexto truncado]");
  expect(result.omittedMessages).toBeGreaterThan(0);
  expect(result.modelCalls).toBe(0);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/main/orchestration/context-compiler.test.ts src/main/orchestration/run-service.test.ts`

Expected: FAIL because current compaction slices the final string.

- [ ] **Step 3: Implement priority packing**

Estimate each complete entry, keep authoritative sections immutable, add newest entries while budget remains, and return omitted counts by category. If authoritative state alone exceeds the budget, use fixed field limits rather than slicing arbitrary bytes.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/main/orchestration/context-compiler.test.ts src/main/orchestration/run-service.test.ts`

Expected: PASS with deterministic fingerprints and zero model calls.

- [ ] **Step 5: Commit sprint 4**

```bash
git add src/main/orchestration
git commit -m "feat: compact provider context deterministically"
```

### Task 5: Finish Honest Telemetry and Provider Conformance

**Files:**
- Create: `src/main/runtime/conformance.test.ts`
- Modify: `src/main/runtime/manifest.test.ts`
- Modify: `src/main/usage/service.test.ts`
- Modify: `src/main/usage/service.ts`
- Modify: `src/renderer/features/workbench/Conversation.test.tsx`
- Modify: `src/renderer/features/workbench/Conversation.tsx`

**Interfaces:**
- Consumes: canonical events from all eight runtime adapters.
- Produces: one conformance result per runtime and a visible telemetry state of numeric, unavailable, or not-reported.

- [ ] **Step 1: Write the failing parameterized conformance gate**

```ts
it.each(runtimeFixtures)(
  "$runtime terminates once and reports truthful usage state",
  async ({ project }) => {
    const events = await project();
    expect(terminalEvents(events)).toHaveLength(1);
    expect(usageState(events)).toMatch(/numeric|unavailable|not-reported/);
  },
);
```

- [ ] **Step 2: Run the gate and verify RED**

Run: `pnpm vitest run src/main/runtime/conformance.test.ts`

Expected: FAIL for any adapter with duplicate terminal events or mismatched usage claims.

- [ ] **Step 3: Normalize remaining usage states**

Keep numeric values only from provider output. Emit `available:false` for protocols proven not to expose tokens. Leave quota unavailable for MiMo and any other provider without a stable source.

- [ ] **Step 4: Make the UI visually distinguish telemetry states**

Use the existing compact metadata row:

```text
✓ Concluído   2s   1.8k tokens
✓ Concluído   1s   tokens indisponíveis · CLI não informa
```

No new card, modal, gradient, or decorative animation is introduced.

- [ ] **Step 5: Run conformance and renderer tests**

Run: `pnpm vitest run src/main/runtime/conformance.test.ts src/main/usage/service.test.ts src/renderer/features/workbench/Conversation.test.tsx`

Expected: PASS for all built-ins.

- [ ] **Step 6: Commit sprint 5**

```bash
git add src/main/runtime src/main/usage src/renderer/features/workbench
git commit -m "test: enforce provider runtime conformance"
```

### Task 6: Add the Lane Health Surface and Update Documentation

**Files:**
- Modify: `src/renderer/features/workbench/Conversation.tsx`
- Modify: `src/renderer/features/workbench/Conversation.test.tsx`
- Modify: `src/renderer/styles/workbench.css`
- Modify: `README.md`
- Modify: `README.pt-BR.md`
- Modify: `docs/releases/v1.0.0-beta.1.md`
- Modify: `docs/releases/v1.0.0-beta.1.pt-BR.md`

**Interfaces:**
- Consumes: lane runtime/model, run status, context telemetry, and usage state.
- Produces: accessible lane-health summary with exact provider limitations.

- [ ] **Step 1: Write failing accessible UI tests**

```tsx
expect(screen.getByLabelText("Saúde da lane")).toHaveTextContent("Contexto sincronizado");
expect(screen.getByText("CLI não informa tokens")).toBeVisible();
```

- [ ] **Step 2: Run the renderer test and verify RED**

Run: `pnpm vitest run src/renderer/features/workbench/Conversation.test.tsx`

Expected: FAIL because the health summary does not exist.

- [ ] **Step 3: Implement the restrained health summary**

Design system:

- `Graphite #0d0f14`: main surface.
- `Raised graphite #151920`: telemetry surface.
- `Okami cyan #57d7e5`: synchronized/available.
- `Okami amber #ff7a1a`: degraded/attention.
- `Muted silver #8d94a3`: unavailable metadata.
- Existing body and utility fonts only.

Signature: one thin animated activity rail while a lane is running; static and reduced-motion-safe otherwise.

- [ ] **Step 4: Update English and Portuguese documentation**

List all eight runtimes, their executable dependency, authentication owner, token state, quota state, and behavior when the binary is removed. Explain that OpenCode is integrated through ACP and BB is an architectural reference only.

- [ ] **Step 5: Run renderer and documentation checks**

Run: `pnpm vitest run src/renderer/features/workbench/Conversation.test.tsx`

Run: `pnpm exec prettier --check README.md README.pt-BR.md docs/releases docs/architecture`

Expected: PASS.

- [ ] **Step 6: Commit sprint 6**

```bash
git add src/renderer README.md README.pt-BR.md docs
git commit -m "feat: surface lane health and provider limits"
```

### Task 7: Execute Release Gates, Visual QA, and Publish

**Files:**
- Modify only if a gate finds a proven defect.
- Produce: `release/OkamiCode-v1.0.0-beta.1-macOS-arm64.dmg`

**Interfaces:**
- Consumes: completed sprints 1–6.
- Produces: validated DMG and remote branch evidence.

- [ ] **Step 1: Run the full Node gate**

Run: `pnpm rebuild better-sqlite3-multiple-ciphers && pnpm check`

Expected: typecheck, lint, format, and all non-live tests PASS.

- [ ] **Step 2: Run provider live smokes**

Run each provider-specific smoke with the smallest exact-string prompt and record reply, terminal event, and usage state. Do not retry a paid turn more than once.

Expected: Claude, Codex, Cursor, AGY, Grok, MiMo, MiniMax, and OpenCode either pass or expose a precise environment/authentication blocker in the UI and report.

- [ ] **Step 3: Package for Electron ABI**

Run: `pnpm package`

Expected: DMG and blockmap created; unsigned status reported honestly.

- [ ] **Step 4: Run Playwright Electron visual QA**

Run: `pnpm test:e2e`

Expected: all Electron tests PASS with no horizontal overflow, no modal overlap, Node isolation preserved, and screenshots generated.

- [ ] **Step 5: Inspect screenshots**

Inspect Code at 1440×900 plus narrow sidebar and open lane-health states. Reject clipped text, inaccessible contrast, inconsistent control heights, hidden focus, or motion that ignores reduced-motion.

- [ ] **Step 6: Rebuild Node ABI and rerun final gate**

Run: `pnpm rebuild better-sqlite3-multiple-ciphers && pnpm check`

Expected: PASS after packaging.

- [ ] **Step 7: Commit final release evidence**

```bash
git add .
git commit -m "release: finish OkamiCode runtime sprints"
```

- [ ] **Step 8: Publish without rewriting history**

Push the named branch, verify the remote SHA equals local `HEAD`, and create or update the review path selected by the user. Never force-push.

## Completion Audit

- [ ] All seven sprint commits exist or an equivalent smaller commit set proves the same deliverables.
- [ ] `pnpm check` passes after the final native-module rebuild.
- [ ] `pnpm test:e2e` passes outside the macOS sandbox.
- [ ] Every runtime has fixture conformance evidence.
- [ ] Every installed/authenticated runtime has one bounded live-smoke result.
- [ ] Context transfer contains conversation and sanitized operational state exactly once.
- [ ] Compaction never calls a model and never slices a message mid-entry.
- [ ] Tokens and quotas are numeric only when sourced; unavailable states are visible.
- [ ] OpenCode ACP and the BB architectural boundary are documented.
- [ ] DMG exists with checksum and signing status.
- [ ] Local branch and remote branch resolve to the same commit.
