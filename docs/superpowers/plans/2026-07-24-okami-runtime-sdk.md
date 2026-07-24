# Okami Runtime SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OkamiCode own provider orchestration, context, tools, policy, usage, and transport selection so removing an optional provider CLI does not define or corrupt the provider architecture.

**Architecture:** `RuntimeKind` identifies a provider-facing runtime, while `OkamiRuntimeSdk` selects one of its independently described transports. API, OAuth, ACP, embedded, and CLI transports implement the same canonical adapter contract; CLI transports remain compatibility fallbacks and the documented Claude/Cursor subscription exceptions.

**Tech Stack:** TypeScript 6, Zod 4, Vitest, Electron main process, canonical Okami events, native `fetch`.

> **Entitlement correction (2026-07-24):** the original Tasks 2 and 4
> incorrectly treated direct HTTP as the preferred route for every provider.
> Their OpenAI/xAI pay-as-you-go outcome is superseded. The shipped catalog
> contains no pay-as-you-go transport: Codex and Grok use bundled official
> subscription runtimes; MiMo and MiniMax use encrypted Token Plan
> credentials.

## Global Constraints

- No live provider turns in automated verification.
- Never read or refresh credentials owned by another application.
- Claude CLI and Cursor Agent may remain optional subscription transports.
- Provider manifests must not equate a provider with an executable.
- Existing lanes and native session identifiers must remain resumable during migration.
- Every behavioral change follows RED, GREEN, REFACTOR with fresh command output.

---

### Task 1: Transport-independent SDK kernel

**Files:**
- Create: `src/main/runtime/sdk/provider-runtime.ts`
- Test: `src/main/runtime/sdk/provider-runtime.test.ts`
- Modify: `src/main/runtime/manifest.ts`
- Modify: `src/main/runtime/manifest.test.ts`
- Modify: `src/main/runtime/registry.ts`
- Modify: `src/main/runtime/registry.test.ts`

**Interfaces:**
- Consumes: existing `RuntimeAdapter` and canonical `NativeSession` contracts.
- Produces: `ProviderRuntimeAdapter`, `RuntimeTransportDescriptor`, encoded transport session bindings, and provider manifests containing ordered transports.

- [x] **Step 1: Write failing provider runtime tests**

Cover selection of the highest-priority healthy transport, fallback when it is unavailable, transport binding preservation across turns, legacy unprefixed session fallback, cancellation routing, and a provider remaining healthy without its CLI when an API transport is healthy.

- [x] **Step 2: Verify RED**

Run: `pnpm vitest run src/main/runtime/sdk/provider-runtime.test.ts src/main/runtime/manifest.test.ts src/main/runtime/registry.test.ts`

Expected: FAIL because the SDK transport router and schema version 2 do not exist.

- [x] **Step 3: Implement the minimal SDK kernel**

Add an adapter router that decorates native session identifiers with the selected transport id, remembers run ownership for approval/cancellation, and reports aggregate health without exposing executable assumptions at provider level.

- [x] **Step 4: Verify GREEN**

Run: `pnpm vitest run src/main/runtime/sdk/provider-runtime.test.ts src/main/runtime/manifest.test.ts src/main/runtime/registry.test.ts`

Expected: PASS.

### Task 2: First-party HTTP transport

**Files:**
- Create: `src/main/runtime/sdk/responses-transport.ts`
- Test: `src/main/runtime/sdk/responses-transport.test.ts`
- Create: `src/main/runtime/sdk/credential-source.ts`
- Test: `src/main/runtime/sdk/credential-source.test.ts`
- Modify: `src/main/runtime/registry.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `RuntimeTransportDescriptor`, `RuntimeAdapter`, injected `fetch`, and credentials supplied by Okami's credential vault or environment.
- Produces: a streaming Responses-compatible transport with canonical text, usage, failure, cancellation, and continuation events.

- [x] **Step 1: Write failing HTTP transport tests**

Use local fixtures for SSE streaming, `previous_response_id`, exact usage, abort, missing credentials, and redacted diagnostics.

- [x] **Step 2: Verify RED**

Run: `pnpm vitest run src/main/runtime/sdk/responses-transport.test.ts src/main/runtime/sdk/credential-source.test.ts`

Expected: FAIL because the transport is absent.

- [x] **Step 3: Implement OpenAI and xAI API transports**

Use only documented endpoints and user-owned Okami credentials. Do not import `~/.codex`, browser cookies, or provider-private OAuth client ids.

- [x] **Step 4: Verify GREEN**

Run the two test files again and expect PASS.

### Task 3: Okami-owned agent loop and tools

**Files:**
- Create: `src/main/runtime/sdk/agent-loop.ts`
- Test: `src/main/runtime/sdk/agent-loop.test.ts`
- Create: `src/main/runtime/sdk/tools.ts`
- Test: `src/main/runtime/sdk/tools.test.ts`
- Modify: `src/main/policy/engine.ts`

**Interfaces:**
- Consumes: model streaming transport, existing policy engine, approval broker, workspace root, and canonical event builder.
- Produces: a provider-neutral loop for tool calls, approvals, continuation, compaction, and cancellation.

- [x] **Step 1: Write failing loop and tool-policy tests**

Prove read-only tools, edit approval, shell approval, path containment, tool result continuation, cancellation, and context compaction with deterministic fake model responses.

- [x] **Step 2: Verify RED**

Run both new test files and expect missing implementation failures.

- [x] **Step 3: Implement the minimal safe loop**

Keep tools transport-neutral. Enforce workspace containment and existing leases before mutation. Emit canonical events at each lifecycle boundary.

- [x] **Step 4: Verify GREEN**

Run both files again and expect PASS.

### Task 4: Provider migration and private bridge removal

**Files:**
- Modify: `src/main/runtime/registry.ts`
- Modify: `src/main/index.ts`
- Delete: `src/main/gateway/bridges/chatgpt-backend.ts`
- Modify: `src/main/gateway/bridges/chatgpt.test.ts`
- Modify: `src/main/runtime/conformance.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: OpenAI/xAI direct transports, MiniMax/MiMo API transports where documented, Claude/Cursor optional CLI transports, OpenCode optional ACP transport, and no private ChatGPT backend.

- [x] **Step 1: Write failing migration tests**

Prove that deleting `codex`, `grok`, `mimo`, or `mmx` does not make a provider unavailable when its configured API transport is healthy, and prove no production code reads `.codex/auth.json`.

- [x] **Step 2: Verify RED**

Run registry, conformance, and gateway bridge tests and expect the old architecture assertions to fail.

- [x] **Step 3: Switch provider registration to ordered transports**

Prefer Okami-owned API transports. Keep CLI/ACP entries explicitly optional and report why a provider is unavailable when no configured transport can authenticate.

- [x] **Step 4: Verify GREEN**

Run the focused suite and expect PASS.

### Task 5: Product surface, documentation, and release gates

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/runtime-harness-boundary.md`
- Create: `docs/architecture/okami-runtime-sdk.md`
- Modify: runtime health UI files selected by current IPC consumers.

**Interfaces:**
- Consumes: provider and transport health from Tasks 1-4.
- Produces: honest UI showing active transport, auth source, fallback state, missing configuration, and zero fabricated usage.

- [x] **Step 1: Add failing UI/IPC tests**

Prove provider health is distinct from transport health and that a missing optional CLI is not presented as an application failure.

- [x] **Step 2: Implement UI and documentation**

Document supported auth per provider, optional CLI exceptions, credential ownership, migration behavior, and limitations.

- [x] **Step 3: Run focused tests**

Run the SDK, registry, orchestration, gateway, IPC, and affected renderer tests.

- [x] **Step 4: Run the final gate**

### Task 6: Remove pay-as-you-go and global Codex/Grok dependencies

- [x] Pin and bundle the official Codex and Grok platform runtimes.
- [x] Route Codex and Grok through provider-owned subscription sessions.
- [x] Add OAuth/device-connection initiation inside Settings.
- [x] Add an Electron `safeStorage` vault for MiMo and MiniMax Token Plan
      credentials.
- [x] Reject ordinary MiMo/MiniMax pay-as-you-go key families.
- [x] Add a manifest regression test that forbids built-in `payg` transports.
- [x] Show subscription or Token Plan entitlement in runtime diagnostics.
- [x] Verify the bundled arm64 Codex and Grok executables from the packaged
      application.

Run: `pnpm rebuild better-sqlite3-multiple-ciphers && pnpm check`

Expected: exit 0 with typecheck, lint, format, and tests passing.
