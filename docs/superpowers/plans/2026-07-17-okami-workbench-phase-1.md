# Okami Workbench Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a bundle-ready macOS desktop application in which Marcos can run and resume real Claude Code and Codex subscription sessions through one chat-native UI, inspect native tools and approvals, switch persistent lanes without an auxiliary model, search local Obsidian context, and see honest usage data.

**Architecture:** A Tauri 2 shell hosts a React/TypeScript UI and a Rust core. The Rust core owns encrypted SQLite state, Keychain access, process supervision, policy enforcement, event normalization, lane synchronization, usage collection, and memory retrieval; the frontend receives typed projections through narrow Tauri commands and events. Claude Code and Codex remain the actual harnesses, and every normalized event retains its native reference for audit and debugging.

**Tech Stack:** macOS 26 arm64, Node.js 24.17.0, pnpm 11.5.2, React 19.2.7, TypeScript 7.0.2, Vite 8.1.5, Tauri CLI 2.11.4, Tauri Rust 2.11.5, Rust 1.86.0, Tokio 1.53.0, HeroUI 3.2.2, Tailwind CSS 4.3.3, rusqlite 0.40.1 with bundled SQLCipher, keyring 3.6.3, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.61.1.

## Global Constraints

- Initial target is macOS 26 on Apple Silicon; do not broaden this plan to Windows or Linux.
- Phase 1 includes only the daily Workbench: Claude Code, Codex, lanes, native tool surfaces, global quick chat, Usage Control Center, SQLite/FTS5, basic read-only Obsidian indexing, leases, audit, and restart recovery.
- Do not implement email, WhatsApp, calendar, Kanban, Grok, Cursor, AGY, OpenCode, MiniMax, MiMo, Holographic/HRR, GBrain, or persistent automation in this plan.
- A run has exactly one executor. No hidden supervisory model, summarization model, paid API fallback, or silent provider switch is permitted.
- Claude and Codex must use the user's installed CLI subscription authentication. Live tests must never inject `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
- Default live CLI versions for fixtures are Claude Code `2.1.212` and Codex CLI `0.144.5`; adapters must probe versions and degrade explicitly when an unsupported protocol is detected.
- All privileged operations originate in Rust. The webview cannot spawn arbitrary processes, read Keychain values, access SQLite directly, or bypass leases.
- Store secrets only in macOS Keychain. Store operational data in SQLCipher. Redact native payloads before logs, fixtures, or audit exports.
- Keep modules focused: target 250 lines and split any production source file before 400 lines.
- Frontend tasks must load the `frontend-design` skill and use the Okami design system at `https://okamiops.com/design-system/`; validate contrast, overlap, responsive behavior, keyboard flow, focus, and CSS application visually.
- Use HeroUI 3 primitives and Lucide icons before introducing custom interactive components or bespoke icons. Keep Okami identity in a thin theme/token layer, reuse shared components, and write custom CSS only for product-specific layout or visual signatures that the component library cannot express cleanly.
- Keep code readable without narration: comments explain non-obvious invariants, protocol quirks, or security boundaries only; never restate self-explanatory code.
- Use `apply_patch` for authored file changes. Generated lockfiles and protocol schemas may be produced by their official generators.
- The existing user npm and Cargo caches are not writable in the managed environment. All commands use repository-local `.cache/pnpm` and `.cache/cargo`, both ignored by Git.
- Default tests must not consume subscription quota. Live adapter and end-to-end tests run only with `OKAMI_RUN_LIVE_CLI_TESTS=1` and must print the selected runtime/model before sending a turn.
- Every task finishes with its focused tests, the relevant full gate, and one commit. Do not combine tasks into a giant commit.

---

## Delivery Sprints

| Sprint | Tasks | Reviewable outcome |
|---|---|---|
| 0 — Foundation | 1–3 | App boots, contracts are stable, encrypted state opens safely |
| 1 — Trusted core | 4–6 | Events persist, leases gate actions, process transport survives cancellation |
| 2 — Real runtimes | 7–9 | Codex and Claude run natively; lanes resume and sync only deltas |
| 3 — Desktop experience | 10–14 | Okami shell, chat, tool surfaces, approvals, quick chat |
| 4 — Usage and memory | 15–16 | Honest limits/activity and read-only Obsidian retrieval |
| 5 — Recovery and release | 17–18 | Restart recovery, audit, visual/E2E proof, bundle-ready app/DMG candidate |

## Planned File Map

```text
.
├── .cargo/config.toml                   # shared Rust target directory
├── .npmrc                               # repository-local pnpm store
├── package.json                         # frontend/Tauri scripts and pinned JS dependencies
├── playwright.config.ts                 # mocked-webview visual/E2E suite
├── src/
│   ├── app/                             # router, providers, shell composition
│   ├── components/                      # shared accessible UI primitives
│   ├── features/workbench/              # task/lane/chat/tool surfaces
│   ├── features/quick-chat/             # workspace-free conversations
│   ├── features/usage/                  # Usage Control Center and popover
│   ├── lib/contracts/                   # Zod schemas matching canonical Rust types
│   ├── lib/ipc/                         # typed Tauri client and event subscription
│   ├── styles/                          # Okami tokens and global responsive rules
│   └── test/                            # Vitest setup, fixtures, mocked IPC
├── src-tauri/
│   ├── capabilities/                    # least-privilege Tauri capabilities
│   ├── migrations/                      # SQLCipher/FTS5 schema
│   ├── src/bin/okami-hook.rs            # Claude hook bridge, no inference
│   ├── src/commands/                    # narrow Tauri command facade
│   ├── src/db/                          # encrypted connection and repositories
│   ├── src/domain/                      # canonical task/lane/run/event contracts
│   ├── src/memory/                      # Obsidian scanner and FTS retrieval
│   ├── src/orchestration/               # lane resume, delta builder, recovery
│   ├── src/policy/                      # leases, approvals, preflight
│   ├── src/runtime/                     # generic transport, Codex, Claude
│   ├── src/usage/                       # collectors, snapshots, aggregation
│   ├── src/app_state.rs                 # dependency composition only
│   ├── src/lib.rs                       # Tauri setup
│   └── tests/                           # Rust integration and opt-in live tests
├── tests/e2e/                           # Playwright mocked-webview flows
├── tests/fixtures/                      # sanitized native protocol fixtures
└── scripts/                             # doctor, fixture refresh, live smoke, release gate
```

### Task 1: Scaffold the Tauri application and quality gates

**Files:**
- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `.cargo/config.toml`
- Create: `package.json`
- Create: `pnpm-lock.yaml` (generated)
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/test/setup.ts`
- Create: `src/app/App.test.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/main.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: existing product specification only.
- Produces: `okami-workbench` Tauri binary, `pnpm check`, `pnpm test`, `pnpm cargo:test`, and a React root that later tasks extend.

- [ ] **Step 1: Add a failing frontend boot test**

```tsx
// src/app/App.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the Workbench product identity", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Okami Workbench" })).toBeVisible();
  });
});
```

- [ ] **Step 2: Create the pinned scaffold and install dependencies**

Generate the official React/TypeScript Tauri 2 scaffold in a disposable directory, inspect it, then reproduce only the required files in the repository with `apply_patch`. This avoids an overwrite-capable `--force` operation and guarantees `docs/` is untouched:

```bash
npm_config_cache=$PWD/.cache/npm npx --yes create-tauri-app@4.6.2 /tmp/okami-workbench-scaffold --manager pnpm --template react-ts --identifier com.okami.workbench --tauri-version 2 --yes
test -f docs/superpowers/specs/2026-07-17-okami-workbench-unified-desktop-design.md
```

Set `.npmrc` to this exact content before installing packages:

```ini
store-dir=.cache/pnpm
```

Set the toolchain/cache files exactly:

```text
# .nvmrc
24.17.0
```

```toml
# .cargo/config.toml
[build]
target-dir = ".cache/target"
```

Append these entries to `.gitignore` without removing the existing `.superpowers/` rule:

```gitignore
.cache/
dist/
src-tauri/target/
test-results/
playwright-report/
```

Use this exact script surface in `package.json`:

```json
{
  "name": "okami-workbench",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@11.5.2",
  "scripts": {
    "dev": "CARGO_HOME=$PWD/.cache/cargo tauri dev",
    "build": "tsc -b && vite build",
    "tauri:build": "CARGO_HOME=$PWD/.cache/cargo tauri build --bundles app,dmg",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint . --max-warnings 0",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "PLAYWRIGHT_BROWSERS_PATH=$PWD/.cache/ms-playwright playwright test",
    "cargo:fmt": "CARGO_HOME=$PWD/.cache/cargo cargo fmt --manifest-path src-tauri/Cargo.toml --check",
    "cargo:clippy": "CARGO_HOME=$PWD/.cache/cargo cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings",
    "cargo:test": "CARGO_HOME=$PWD/.cache/cargo cargo test --manifest-path src-tauri/Cargo.toml",
    "check": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm cargo:fmt && pnpm cargo:clippy && pnpm cargo:test"
  }
}
```

Install HeroUI v3 with its CSS-first Tailwind v4 integration, then install the remaining dependencies:

```bash
pnpm add --save-exact @heroui/react@3.2.2 @heroui/styles@3.2.2 @tanstack/react-query@5.101.2 @tauri-apps/api@2.11.1 lucide-react@1.25.0 react@19.2.7 react-dom@19.2.7 react-markdown@10.1.0 react-router-dom@7.18.1 remark-gfm@4.0.1 tailwindcss@4.3.3 zod@4.4.3 zustand@5.0.14
pnpm add --save-dev --save-exact @eslint/js@10.0.1 @playwright/test@1.61.1 @tailwindcss/vite@4.3.3 @tauri-apps/cli@2.11.4 @testing-library/jest-dom@6.9.1 @testing-library/react@16.3.2 @types/node@26.1.1 @types/react@19.2.17 @types/react-dom@19.2.3 @vitejs/plugin-react@6.0.3 eslint@10.7.0 eslint-plugin-jsx-a11y@6.10.2 eslint-plugin-react-hooks@7.1.1 eslint-plugin-react-refresh@0.5.3 globals@17.7.0 jsdom@29.1.1 prettier@3.9.5 typescript@7.0.2 typescript-eslint@8.64.0 vite@8.1.5 vitest@4.1.10
```

`src/styles/global.css` must import Tailwind before HeroUI, following the official v3 order:

```css
@import "tailwindcss";
@import "@heroui/styles";
```

Expected: `pnpm-lock.yaml` is created under the repository; no file is written below `~/.npm` or `~/.local/share/pnpm`.

- [ ] **Step 3: Implement the minimal desktop root and Rust shell**

```tsx
// src/app/App.tsx
import "../styles/tokens.css";
import "../styles/global.css";

export function App() {
  return (
    <main className="boot-shell">
      <p className="eyebrow">Local-first AI work OS</p>
      <h1>Okami Workbench</h1>
      <p>Starting trusted core…</p>
    </main>
  );
}
```

```rust
// src-tauri/src/lib.rs
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run Okami Workbench");
}
```

Pin the initial Rust manifest:

```toml
[package]
name = "okami-workbench"
version = "0.1.0"
edition = "2021"

[lib]
name = "okami_workbench_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = "=2.6.3"

[dependencies]
serde = { version = "=1.0.228", features = ["derive"] }
serde_json = "=1.0.150"
tauri = "=2.11.5"
```

- [ ] **Step 4: Run the complete scaffold gate**

Run:

```bash
pnpm test src/app/App.test.tsx
pnpm build
pnpm cargo:test
pnpm check
```

Expected: all four commands exit `0`; Vitest reports `1 passed`; Vite produces `dist/`; Cargo builds `okami-workbench` without warnings.

- [ ] **Step 5: Commit the scaffold**

```bash
git add .gitignore .nvmrc .npmrc .cargo package.json pnpm-lock.yaml index.html vite.config.ts vitest.config.ts tsconfig.json eslint.config.js src src-tauri
git commit -m "chore: scaffold Okami Workbench desktop"
```

### Task 2: Define canonical domain and event contracts

**Files:**
- Create: `src-tauri/src/domain/mod.rs`
- Create: `src-tauri/src/domain/ids.rs`
- Create: `src-tauri/src/domain/task.rs`
- Create: `src-tauri/src/domain/lane.rs`
- Create: `src-tauri/src/domain/event.rs`
- Create: `src/lib/contracts/event.ts`
- Create: `src/lib/contracts/lane.ts`
- Create: `tests/fixtures/contracts/canonical-event-v1.json`
- Create: `src-tauri/tests/contract_fixtures.rs`
- Create: `src/lib/contracts/event.test.ts`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `serde`, `serde_json`, `zod`.
- Produces: `TaskId`, `LaneId`, `RunId`, `CanonicalEvent`, `CanonicalEventKind`, `RuntimeKind`, `ProviderKind`, `LaneStatus`, and matching Zod schemas used by persistence, adapters, IPC, and UI.

- [ ] **Step 1: Write failing Rust and TypeScript contract tests**

```rust
// src-tauri/tests/contract_fixtures.rs
use okami_workbench_lib::domain::CanonicalEvent;

#[test]
fn canonical_event_fixture_round_trips() {
    let raw = include_str!("../../tests/fixtures/contracts/canonical-event-v1.json");
    let event: CanonicalEvent = serde_json::from_str(raw).expect("fixture must deserialize");
    assert_eq!(event.schema_version, 1);
    assert_eq!(event.sequence, 7);
    assert_eq!(serde_json::to_value(event).unwrap()["kind"], "tool_call_completed");
}
```

```ts
// src/lib/contracts/event.test.ts
import fixture from "../../../tests/fixtures/contracts/canonical-event-v1.json";
import { describe, expect, it } from "vitest";
import { canonicalEventSchema } from "./event";

it("accepts the shared canonical event fixture", () => {
  const event = canonicalEventSchema.parse(fixture);
  expect(event.schemaVersion).toBe(1);
  expect(event.kind).toBe("tool_call_completed");
});
```

- [ ] **Step 2: Run the tests and verify missing-contract failures**

Run:

```bash
pnpm test src/lib/contracts/event.test.ts
pnpm cargo:test --test contract_fixtures
```

Expected: TypeScript fails with `Cannot find module './event'`; Rust fails because `domain` is not exported.

- [ ] **Step 3: Implement the canonical version-1 envelope**

Add the ID dependency before compiling the domain types:

```toml
uuid = { version = "=1.24.0", features = ["v4", "serde"] }
```

```rust
// src-tauri/src/domain/event.rs
use serde::{Deserialize, Serialize};
use serde_json::Value;
use super::{LaneId, RunId, TaskId};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CanonicalEventKind {
    SessionStarted,
    SessionResumed,
    MessageDelta,
    MessageCompleted,
    ToolCallStarted,
    ToolCallUpdated,
    ToolCallCompleted,
    ApprovalRequested,
    ApprovalResolved,
    SubagentStarted,
    SubagentCompleted,
    UsageReported,
    RateLimitUpdated,
    RunFailed,
    RunCompleted,
}

impl CanonicalEventKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SessionStarted => "session_started",
            Self::SessionResumed => "session_resumed",
            Self::MessageDelta => "message_delta",
            Self::MessageCompleted => "message_completed",
            Self::ToolCallStarted => "tool_call_started",
            Self::ToolCallUpdated => "tool_call_updated",
            Self::ToolCallCompleted => "tool_call_completed",
            Self::ApprovalRequested => "approval_requested",
            Self::ApprovalResolved => "approval_resolved",
            Self::SubagentStarted => "subagent_started",
            Self::SubagentCompleted => "subagent_completed",
            Self::UsageReported => "usage_reported",
            Self::RateLimitUpdated => "rate_limit_updated",
            Self::RunFailed => "run_failed",
            Self::RunCompleted => "run_completed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalEvent {
    pub schema_version: u16,
    pub id: String,
    pub task_id: TaskId,
    pub lane_id: LaneId,
    pub run_id: RunId,
    pub sequence: u64,
    pub occurred_at: String,
    pub kind: CanonicalEventKind,
    pub native_event_id: Option<String>,
    pub payload: Value,
}
```

```ts
// src/lib/contracts/event.ts
import { z } from "zod";

export const canonicalEventKindSchema = z.enum([
  "session_started", "session_resumed", "message_delta", "message_completed",
  "tool_call_started", "tool_call_updated", "tool_call_completed",
  "approval_requested", "approval_resolved", "subagent_started",
  "subagent_completed", "usage_reported", "rate_limit_updated",
  "run_failed", "run_completed",
]);

export const canonicalEventSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  taskId: z.string().uuid(),
  laneId: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime({ offset: true }),
  kind: canonicalEventKindSchema,
  nativeEventId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
```

`tests/fixtures/contracts/canonical-event-v1.json`:

```json
{
  "schemaVersion": 1,
  "id": "evt-fixture-7",
  "taskId": "11111111-1111-4111-8111-111111111111",
  "laneId": "22222222-2222-4222-8222-222222222222",
  "runId": "33333333-3333-4333-8333-333333333333",
  "sequence": 7,
  "occurredAt": "2026-07-17T18:00:00Z",
  "kind": "tool_call_completed",
  "nativeEventId": "native-tool-7",
  "payload": { "tool": "Read", "status": "completed" }
}
```

Use transparent UUID newtypes in `ids.rs`, and make `task.rs`/`lane.rs` define explicit status enums rather than free-form strings.

```rust
// src-tauri/src/domain/ids.rs
macro_rules! uuid_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub uuid::Uuid);
        impl $name { pub fn new() -> Self { Self(uuid::Uuid::new_v4()) } }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { self.0.fmt(f) }
        }
    };
}
uuid_id!(TaskId);
uuid_id!(LaneId);
uuid_id!(RunId);

// src-tauri/src/domain/lane.rs
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKind { Claude, Codex }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LaneStatus { Ready, Running, WaitingApproval, Interrupted, Failed, Closed }
```

- [ ] **Step 4: Run both contract suites and type checking**

Run:

```bash
pnpm test src/lib/contracts/event.test.ts
pnpm cargo:test --test contract_fixtures
pnpm typecheck
```

Expected: all pass; the same JSON fixture is accepted in Rust and TypeScript.

- [ ] **Step 5: Commit the contracts**

```bash
git add src-tauri/src/domain src-tauri/src/lib.rs src-tauri/tests/contract_fixtures.rs src/lib/contracts tests/fixtures/contracts
git commit -m "feat: define canonical workbench contracts"
```

### Task 3: Open encrypted SQLite state with a Keychain-owned key

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/connection.rs`
- Create: `src-tauri/src/db/migrations.rs`
- Create: `src-tauri/src/secrets.rs`
- Create: `src-tauri/migrations/V001__phase1_core.sql`
- Create: `src-tauri/tests/encrypted_database.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: domain IDs from Task 2.
- Produces: `SecretStore`, `MacKeychainSecretStore`, `Database::open(path, key)`, `Database::in_memory_for_test()`, and migration version 1 for all Phase 1 repositories.

- [ ] **Step 1: Write failing encryption and migration tests**

```rust
// src-tauri/tests/encrypted_database.rs
use okami_workbench_lib::db::Database;
use tempfile::tempdir;

#[test]
fn database_is_sqlcipher_encrypted_and_migrated() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("workbench.db");
    let db = Database::open(&path, &[7_u8; 32]).unwrap();
    assert!(!db.cipher_version().unwrap().is_empty());
    assert_eq!(db.user_version().unwrap(), 1);
    drop(db);
    assert!(Database::open(&path, &[8_u8; 32]).is_err());
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm cargo:test --test encrypted_database
```

Expected: FAIL because `okami_workbench_lib::db` does not exist.

- [ ] **Step 3: Implement Keychain abstraction, SQLCipher open, and the complete Phase 1 schema**

Add these dependencies exactly:

```toml
base64 = "=0.22.1"
chrono = { version = "=0.4.45", features = ["serde"] }
keyring = { version = "=3.6.3", default-features = false, features = ["apple-native"] }
parking_lot = "=0.12.5"
rand = "=0.9.2"
rusqlite = { version = "=0.40.1", features = ["bundled-sqlcipher-vendored-openssl", "chrono", "serde_json", "uuid"] }
sha2 = "=0.11.0"
tempfile = "=3.27.0"
thiserror = "=2.0.18"
```

```rust
// src-tauri/src/db/connection.rs
pub struct Database {
    connection: parking_lot::Mutex<rusqlite::Connection>,
}

impl Database {
    pub fn open(path: &std::path::Path, key: &[u8; 32]) -> Result<Self, DbError> {
        let connection = rusqlite::Connection::open(path)?;
        let key_hex = key.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        connection.pragma_update(None, "key", format!("x'{key_hex}'"))?;
        connection.pragma_update(None, "cipher_memory_security", "ON")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let cipher: String = connection.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
        if cipher.is_empty() { return Err(DbError::CipherUnavailable); }
        super::migrations::run(&mut connection)?;
        Ok(Self { connection: parking_lot::Mutex::new(connection) })
    }
}
```

```rust
// src-tauri/src/secrets.rs
pub trait SecretStore: Send + Sync {
    fn get_or_create_database_key(&self) -> Result<[u8; 32], SecretError>;
}

pub struct MacKeychainSecretStore;

impl SecretStore for MacKeychainSecretStore {
    fn get_or_create_database_key(&self) -> Result<[u8; 32], SecretError> {
        let entry = keyring::Entry::new("com.okami.workbench", "sqlcipher-key")?;
        if let Ok(encoded) = entry.get_password() {
            return decode_32_bytes(&encoded);
        }
        let key = rand::random::<[u8; 32]>();
        entry.set_password(&base64::engine::general_purpose::STANDARD.encode(key))?;
        Ok(key)
    }
}
```

The migration must create these concrete tables with UUID text primary keys, foreign keys, `created_at`/`updated_at` UTC text columns, and indexes on every foreign key and event cursor: `tasks`, `conversations`, `messages`, `runtime_lanes`, `native_session_bindings`, `runs`, `events`, `event_cursors`, `artifacts`, `approvals`, `capability_leases`, `usage_sources`, `usage_windows`, `usage_snapshots`, `usage_activity_buckets`, `memory_sources`, `memory_documents`, `audit_entries`. It must also create `memory_fts` using FTS5 with `content='memory_documents'` plus insert/update/delete sync triggers. Set `PRAGMA user_version = 1` only after every statement succeeds inside one transaction.

```sql
-- src-tauri/migrations/V001__phase1_core.sql
BEGIN IMMEDIATE;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('workbench','quick_chat')),
  title TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX conversations_task_idx ON conversations(task_id);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  sequence INTEGER NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(conversation_id, sequence)
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, sequence);
CREATE TABLE runtime_lanes (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), runtime_kind TEXT NOT NULL,
  provider_kind TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
  workspace_path TEXT, last_event_cursor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX runtime_lanes_task_idx ON runtime_lanes(task_id);
CREATE TABLE native_session_bindings (
  lane_id TEXT PRIMARY KEY REFERENCES runtime_lanes(id), native_session_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL, bound_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  lane_id TEXT NOT NULL REFERENCES runtime_lanes(id), status TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT, error_json TEXT
);
CREATE INDEX runs_lane_idx ON runs(lane_id, started_at);
CREATE TABLE events (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
  lane_id TEXT NOT NULL REFERENCES runtime_lanes(id), run_id TEXT NOT NULL REFERENCES runs(id),
  sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL, kind TEXT NOT NULL,
  native_event_id TEXT, payload_json TEXT NOT NULL,
  UNIQUE(lane_id, sequence)
);
CREATE UNIQUE INDEX events_native_id_idx ON events(lane_id, native_event_id) WHERE native_event_id IS NOT NULL;
CREATE INDEX events_run_idx ON events(run_id, sequence);
CREATE TABLE event_cursors (
  lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  source_lane_id TEXT NOT NULL REFERENCES runtime_lanes(id), last_sequence INTEGER NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(lane_id, source_lane_id)
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL,
  uri TEXT NOT NULL, content_hash TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX artifacts_run_idx ON artifacts(run_id);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  capability TEXT NOT NULL, resource_json TEXT NOT NULL, risk TEXT NOT NULL, status TEXT NOT NULL,
  resolution TEXT, requested_at TEXT NOT NULL, resolved_at TEXT, expires_at TEXT NOT NULL
);
CREATE INDEX approvals_lane_status_idx ON approvals(lane_id, status);
CREATE TABLE capability_leases (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  actor TEXT NOT NULL, capability TEXT NOT NULL, resource_pattern TEXT NOT NULL,
  budget_json TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX leases_lane_capability_idx ON capability_leases(lane_id, capability, expires_at);
CREATE TABLE usage_sources (
  id TEXT PRIMARY KEY, provider_kind TEXT NOT NULL, account_ref TEXT NOT NULL,
  source_kind TEXT NOT NULL, adapter_version TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(provider_kind, account_ref, source_kind)
);
CREATE TABLE usage_windows (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES usage_sources(id), window_kind TEXT NOT NULL,
  model_group TEXT, duration_minutes INTEGER, UNIQUE(source_id, window_kind, model_group)
);
CREATE TABLE usage_snapshots (
  id TEXT PRIMARY KEY, window_id TEXT NOT NULL REFERENCES usage_windows(id),
  used_percent REAL, remaining_percent REAL, resets_at TEXT, credits_json TEXT,
  freshness TEXT NOT NULL, reliability TEXT NOT NULL, native_payload_json TEXT,
  collected_at TEXT NOT NULL, valid_until TEXT
);
CREATE INDEX usage_snapshots_window_idx ON usage_snapshots(window_id, collected_at DESC);
CREATE TABLE usage_activity_buckets (
  id TEXT PRIMARY KEY, lane_id TEXT NOT NULL REFERENCES runtime_lanes(id),
  bucket_start TEXT NOT NULL, bucket_minutes INTEGER NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0, cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 0, UNIQUE(lane_id, bucket_start, bucket_minutes, model)
);
CREATE TABLE memory_sources (
  id TEXT PRIMARY KEY, root_path TEXT NOT NULL, scope_path TEXT NOT NULL, access_mode TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(root_path, scope_path)
);
CREATE TABLE memory_documents (
  id INTEGER PRIMARY KEY, source_id TEXT NOT NULL REFERENCES memory_sources(id), path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, frontmatter_json TEXT NOT NULL, plain_text TEXT NOT NULL,
  content_hash TEXT NOT NULL, modified_at TEXT NOT NULL, indexed_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE memory_fts USING fts5(title, plain_text, content='memory_documents', content_rowid='id');
CREATE TRIGGER memory_ai AFTER INSERT ON memory_documents BEGIN
  INSERT INTO memory_fts(rowid,title,plain_text) VALUES(new.id,new.title,new.plain_text);
END;
CREATE TRIGGER memory_ad AFTER DELETE ON memory_documents BEGIN
  INSERT INTO memory_fts(memory_fts,rowid,title,plain_text) VALUES('delete',old.id,old.title,old.plain_text);
END;
CREATE TRIGGER memory_au AFTER UPDATE ON memory_documents BEGIN
  INSERT INTO memory_fts(memory_fts,rowid,title,plain_text) VALUES('delete',old.id,old.title,old.plain_text);
  INSERT INTO memory_fts(rowid,title,plain_text) VALUES(new.id,new.title,new.plain_text);
END;
CREATE TABLE audit_entries (
  id TEXT PRIMARY KEY, task_id TEXT, lane_id TEXT, run_id TEXT, actor TEXT NOT NULL,
  action TEXT NOT NULL, decision TEXT, capability TEXT, resource_json TEXT,
  metadata_json TEXT NOT NULL, occurred_at TEXT NOT NULL
);
CREATE INDEX audit_task_time_idx ON audit_entries(task_id, occurred_at);

PRAGMA user_version = 1;
COMMIT;
```

- [ ] **Step 4: Verify encryption, schema, and repository-wide Rust quality**

Run:

```bash
pnpm cargo:test --test encrypted_database
pnpm cargo:fmt
pnpm cargo:clippy
```

Expected: encryption test passes; wrong-key open returns `DbError`; Clippy reports no warnings.

- [ ] **Step 5: Commit encrypted persistence**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/migrations src-tauri/src/db src-tauri/src/secrets.rs src-tauri/src/lib.rs src-tauri/tests/encrypted_database.rs
git commit -m "feat: add encrypted local persistence"
```

### Task 4: Implement append-only event, task, lane, and run repositories

**Files:**
- Create: `src-tauri/src/db/tasks.rs`
- Create: `src-tauri/src/db/lanes.rs`
- Create: `src-tauri/src/db/runs.rs`
- Create: `src-tauri/src/db/events.rs`
- Create: `src-tauri/src/db/audit.rs`
- Create: `src-tauri/tests/support/mod.rs`
- Create: `src-tauri/tests/repositories.rs`
- Modify: `src-tauri/src/db/mod.rs`

**Interfaces:**
- Consumes: `Database`, canonical domain types.
- Produces: `TaskRepository`, `LaneRepository`, `RunRepository`, `EventRepository::append`, `EventRepository::after_cursor`, `EventRepository::claim_idempotency_key`, and `AuditRepository::record`.

- [ ] **Step 1: Write failing repository behavior tests**

```rust
// src-tauri/tests/repositories.rs
mod support;
use support::{sequence_event, TestDatabase};

#[test]
fn event_append_is_idempotent_and_cursor_ordered() {
    let fixture = TestDatabase::new();
    let first = fixture.event(sequence_event(1, "native-1"));
    assert!(fixture.events.append(&first).unwrap().inserted);
    assert!(!fixture.events.append(&first).unwrap().inserted);
    fixture.events.append(&fixture.event(sequence_event(2, "native-2"))).unwrap();
    let delta = fixture.events.after_cursor(first.lane_id, 1).unwrap();
    assert_eq!(delta.iter().map(|event| event.sequence).collect::<Vec<_>>(), vec![2]);
}
```

- [ ] **Step 2: Run the focused suite and verify it fails**

Run: `pnpm cargo:test --test repositories`

Expected: FAIL because repository modules and `TestDatabase` do not exist.

- [ ] **Step 3: Implement transactional repositories**

```rust
// src-tauri/src/db/events.rs
pub fn append(&self, event: &CanonicalEvent) -> Result<AppendOutcome, DbError> {
    self.db.with_transaction(|tx| {
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO events
             (id, task_id, lane_id, run_id, sequence, occurred_at, kind, native_event_id, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                event.id, event.task_id, event.lane_id, event.run_id,
                event.sequence, event.occurred_at, event.kind.as_str(),
                event.native_event_id, serde_json::to_string(&event.payload)?
            ],
        )? == 1;
        Ok(AppendOutcome { inserted })
    })
}
```

Use a unique constraint on `(lane_id, sequence)` and a second unique partial index on `(lane_id, native_event_id)` where the native ID is not null. Repository update methods must use optimistic `updated_at` checks; event rows expose no update or delete method.

```rust
// src-tauri/tests/support/mod.rs
pub struct TestDatabase {
    pub db: std::sync::Arc<Database>,
    pub events: EventRepository,
    pub task_id: TaskId,
    pub lane_id: LaneId,
    pub run_id: RunId,
}

impl TestDatabase {
    pub fn new() -> Self {
        let db = std::sync::Arc::new(Database::in_memory_for_test().unwrap());
        Self::seed(db)
    }
    pub fn event(&self, mut event: CanonicalEvent) -> CanonicalEvent {
        event.task_id = self.task_id;
        event.lane_id = self.lane_id;
        event.run_id = self.run_id;
        event
    }
}
```

- [ ] **Step 4: Run repository and encryption regression suites**

Run:

```bash
pnpm cargo:test --test repositories
pnpm cargo:test --test encrypted_database
pnpm cargo:clippy
```

Expected: all pass; duplicate native events do not create duplicate projections.

- [ ] **Step 5: Commit repositories**

```bash
git add src-tauri/src/db src-tauri/tests/support src-tauri/tests/repositories.rs
git commit -m "feat: persist tasks lanes runs and events"
```

### Task 5: Enforce capability leases and approval state transitions

**Files:**
- Create: `src-tauri/src/policy/mod.rs`
- Create: `src-tauri/src/policy/action.rs`
- Create: `src-tauri/src/policy/lease.rs`
- Create: `src-tauri/src/policy/approval.rs`
- Create: `src-tauri/tests/policy_engine.rs`
- Modify: `src-tauri/src/domain/event.rs`
- Modify: `src-tauri/src/db/audit.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: task/lane IDs, `CapabilityLease` table, audit repository.
- Produces: `PolicyEngine::authorize(ActionRequest) -> AuthorizationDecision`, `ApprovalBroker::request`, `ApprovalBroker::resolve`, and expiry-safe lease validation used by every runtime and Tauri command.

- [ ] **Step 1: Write failing least-privilege tests**

```rust
// src-tauri/tests/policy_engine.rs
#[test]
fn expired_or_out_of_scope_lease_never_authorizes() {
    let harness = PolicyHarness::new();
    let lease = harness.lease("workspace.read", "/repo-a", "2026-07-17T19:00:00Z");
    assert_eq!(
        harness.authorize_at(&lease, "workspace.read", "/repo-b", "2026-07-17T18:00:00Z"),
        AuthorizationDecision::Deny(DenyReason::ResourceMismatch)
    );
    assert_eq!(
        harness.authorize_at(&lease, "workspace.read", "/repo-a", "2026-07-17T20:00:00Z"),
        AuthorizationDecision::Deny(DenyReason::Expired)
    );
}

#[test]
fn approval_resolution_is_single_use() {
    let harness = PolicyHarness::new();
    let request = harness.pending_approval("terminal.exec", "git status");
    harness.resolve(&request.id, ApprovalResolution::AllowOnce).unwrap();
    assert!(matches!(
        harness.resolve(&request.id, ApprovalResolution::AllowOnce),
        Err(PolicyError::AlreadyResolved)
    ));
}
```

- [ ] **Step 2: Run the policy test and verify it fails**

Run: `pnpm cargo:test --test policy_engine`

Expected: FAIL because `PolicyEngine` and `ApprovalBroker` are undefined.

- [ ] **Step 3: Implement deterministic authorization without model calls**

```rust
// src-tauri/src/policy/action.rs
#[derive(Debug, Clone)]
pub struct ActionRequest {
    pub actor: Actor,
    pub task_id: TaskId,
    pub lane_id: LaneId,
    pub capability: Capability,
    pub resource: ResourceRef,
    pub risk: RiskLevel,
    pub requested_at: DateTime<Utc>,
}

pub enum AuthorizationDecision {
    Allow { lease_id: String },
    Ask { approval_id: String },
    Deny(DenyReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Actor { Human(String), Runtime(RuntimeKind), Automation(String) }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Capability {
    WorkspaceRead, WorkspaceWrite, TerminalExec, BrowserOpen,
    ApprovalResolve, MemoryRead, AuditExport,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum RiskLevel { Read, Prepare, Execute, Critical }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DenyReason {
    DestructiveOutsideWorkspace, MissingLease, Expired, ActorMismatch,
    TaskMismatch, LaneMismatch, CapabilityMismatch, ResourceMismatch, BudgetExceeded,
}
```

Rules are evaluated in this fixed order: hard deny for destructive/out-of-workspace actions, lease existence, expiry, actor, task/lane scope, capability, resource glob, budget, then risk. `Read` and explicitly leased `Prepare` actions may return `Allow`; external or critical actions always return `Ask`. Every decision writes an audit row before it is returned.

```rust
pub fn authorize(&self, request: &ActionRequest) -> Result<AuthorizationDecision, PolicyError> {
    if request.resource.is_destructive_outside_workspace() {
        return self.audited(request, AuthorizationDecision::Deny(DenyReason::DestructiveOutsideWorkspace));
    }
    let lease = self.leases.find_active(request)?
        .ok_or_else(|| PolicyError::Decision(DenyReason::MissingLease))?;
    lease.validate_actor(&request.actor)?;
    lease.validate_scope(request.task_id, request.lane_id)?;
    lease.validate_capability(&request.capability)?;
    lease.validate_resource(&request.resource)?;
    lease.validate_time_and_budget(request.requested_at)?;
    let decision = if request.risk >= RiskLevel::Execute {
        AuthorizationDecision::Ask { approval_id: self.approvals.create(request)? }
    } else {
        AuthorizationDecision::Allow { lease_id: lease.id }
    };
    self.audited(request, decision)
}
```

- [ ] **Step 4: Run focused tests and all trusted-core tests**

Run:

```bash
pnpm cargo:test --test policy_engine
pnpm cargo:test --test repositories
pnpm cargo:clippy
```

Expected: all pass; no policy code imports a runtime adapter or LLM client.

- [ ] **Step 5: Commit the policy engine**

```bash
git add src-tauri/src/policy src-tauri/src/domain/event.rs src-tauri/src/db/audit.rs src-tauri/src/lib.rs src-tauri/tests/policy_engine.rs
git commit -m "feat: enforce capability leases and approvals"
```

### Task 6: Build cancellable JSONL process transport and runtime supervisor

**Files:**
- Create: `src-tauri/src/runtime/mod.rs`
- Create: `src-tauri/src/runtime/adapter.rs`
- Create: `src-tauri/src/runtime/transport.rs`
- Create: `src-tauri/src/runtime/supervisor.rs`
- Create: `src-tauri/src/runtime/registry.rs`
- Create: `tests/fixtures/runtime/jsonl-echo.mjs`
- Create: `src-tauri/tests/runtime_transport.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: canonical events and Policy Engine.
- Produces: `RuntimeAdapter` trait, `RuntimeRegistry`, `JsonlProcess`, `RuntimeSupervisor`, `RuntimeHandle::send`, `RuntimeHandle::cancel`, and bounded `mpsc::Receiver<NativeEnvelope>`.

- [ ] **Step 1: Write a failing transport lifecycle test**

```rust
// src-tauri/tests/runtime_transport.rs
#[tokio::test]
async fn jsonl_transport_streams_unicode_and_cancels_without_orphaning() {
    let mut process = JsonlProcess::spawn(node_fixture("jsonl-echo.mjs")).await.unwrap();
    process.send(json!({"id": 1, "text": "ação 狼"})).await.unwrap();
    assert_eq!(process.next().await.unwrap()["text"], "ação 狼");
    process.cancel().await.unwrap();
    assert!(process.wait().await.unwrap().success_or_cancelled());
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm cargo:test --test runtime_transport`

Expected: FAIL because `JsonlProcess` is not implemented.

- [ ] **Step 3: Implement bounded UTF-8 JSONL transport and the adapter trait**

Add:

```toml
async-trait = "=0.1.89"
nix = { version = "=0.31.3", features = ["signal"] }
tokio = { version = "=1.53.0", features = ["io-util", "macros", "process", "rt-multi-thread", "sync", "time"] }
tokio-util = { version = "=0.7.18", features = ["rt"] }
tracing = "=0.1.44"
tracing-subscriber = { version = "=0.3.23", features = ["env-filter", "json"] }
```

```rust
// src-tauri/src/runtime/adapter.rs
#[async_trait::async_trait]
pub trait RuntimeAdapter: Send + Sync {
    fn kind(&self) -> RuntimeKind;
    async fn detect(&self) -> Result<RuntimeHealth, RuntimeError>;
    async fn start(&self, request: StartSessionRequest) -> Result<NativeSession, RuntimeError>;
    async fn resume(&self, request: ResumeSessionRequest) -> Result<NativeSession, RuntimeError>;
    async fn send_turn(&self, request: NativeTurnRequest) -> Result<RunHandle, RuntimeError>;
    async fn respond_to_approval(&self, response: ApprovalResponse) -> Result<(), RuntimeError>;
    async fn cancel(&self, run_id: RunId) -> Result<(), RuntimeError>;
    fn usage_capabilities(&self) -> UsageCapabilities;
}
```

`JsonlProcess` must read stdout by bytes through `BufReader::read_until(b'\n')`, validate complete UTF-8 only after a full line, place at most 256 envelopes in memory, send SIGTERM on cancel, wait two seconds, then SIGKILL only for its own child PID. Stderr is a separate redacted diagnostic stream and never enters the canonical conversation.

- [ ] **Step 4: Run cancellation, Unicode, and leak checks**

Run:

```bash
pnpm cargo:test --test runtime_transport
pnpm cargo:test runtime::
pnpm cargo:clippy
```

Expected: all pass; after the test, `pgrep -f jsonl-echo.mjs` returns no fixture process.

- [ ] **Step 5: Commit transport and supervisor**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/runtime src-tauri/src/lib.rs src-tauri/tests/runtime_transport.rs tests/fixtures/runtime/jsonl-echo.mjs
git commit -m "feat: add runtime process supervisor"
```

### Task 7: Integrate Codex app-server with subscription auth and approvals

**Files:**
- Create: `src-tauri/src/runtime/codex/mod.rs`
- Create: `src-tauri/src/runtime/codex/client.rs`
- Create: `src-tauri/src/runtime/codex/protocol.rs`
- Create: `src-tauri/src/runtime/codex/projector.rs`
- Create: `scripts/update-codex-protocol.sh`
- Create: `vendor/codex-protocol/0.144.5/` (generated JSON schema)
- Create: `tests/fixtures/runtime/codex/turn.jsonl`
- Create: `tests/fixtures/runtime/codex/approval.jsonl`
- Create: `src-tauri/tests/codex_projection.rs`
- Create: `src-tauri/tests/live_codex.rs`
- Modify: `src-tauri/src/runtime/registry.rs`

**Interfaces:**
- Consumes: `JsonlProcess`, `RuntimeAdapter`, `ApprovalBroker`, canonical events.
- Produces: `CodexAdapter`, JSON-RPC request correlation, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, approval responses, and structured rate-limit/account methods for Task 15.

- [ ] **Step 1: Write fixture-first projector tests**

```rust
// src-tauri/tests/codex_projection.rs
#[test]
fn codex_tool_and_approval_notifications_project_without_loss() {
    let native = fixture_lines("tests/fixtures/runtime/codex/approval.jsonl");
    let projected = CodexProjector::default().project_all(native).unwrap();
    assert!(projected.iter().any(|event| event.kind == CanonicalEventKind::ToolCallStarted));
    assert!(projected.iter().any(|event| event.kind == CanonicalEventKind::ApprovalRequested));
    assert!(projected.iter().all(|event| event.native_event_id.is_some()));
}
```

- [ ] **Step 2: Generate the versioned schema and verify the projector test fails**

Run:

```bash
mkdir -p vendor/codex-protocol/0.144.5
codex app-server generate-json-schema --out vendor/codex-protocol/0.144.5
pnpm cargo:test --test codex_projection
```

Expected: protocol schema is generated without a model call; test fails because `CodexProjector` is missing.

- [ ] **Step 3: Implement initialize, thread/turn lifecycle, mapping, and approvals**

```rust
// src-tauri/src/runtime/codex/client.rs
pub async fn initialize(&self) -> Result<(), RuntimeError> {
    self.request("initialize", json!({
        "clientInfo": {"name": "okami-workbench", "title": "Okami Workbench", "version": env!("CARGO_PKG_VERSION")},
        "capabilities": {"experimentalApi": false}
    })).await?;
    self.notify("initialized", json!({})).await
}

pub async fn read_rate_limits(&self) -> Result<Value, RuntimeError> {
    self.request("account/rateLimits/read", json!({})).await
}
```

The projector maps `thread/*`, `turn/*`, `item/*`, `error`, and server-initiated approval requests. It keeps unknown items as `tool_call_updated` with `payload.adapterStatus="unknown_native_event"`, never panics on an added field, and responds to approvals only after `ApprovalBroker` returns a valid resolution.

- [ ] **Step 4: Run fixture tests, then an opt-in non-consuming live handshake**

Run:

```bash
pnpm cargo:test --test codex_projection
OKAMI_RUN_LIVE_CLI_TESTS=1 pnpm cargo:test --test live_codex -- --ignored --nocapture
```

Expected: fixture suite passes; live test prints Codex `0.144.5`, initializes app-server, reads account/rate limits, and exits without calling `turn/start`.

- [ ] **Step 5: Commit the Codex adapter and generated schema**

```bash
git add src-tauri/src/runtime/codex src-tauri/src/runtime/registry.rs src-tauri/tests/codex_projection.rs src-tauri/tests/live_codex.rs tests/fixtures/runtime/codex scripts/update-codex-protocol.sh vendor/codex-protocol/0.144.5
git commit -m "feat: integrate Codex app server"
```

### Task 8: Integrate Claude Code stream-json and the policy hook bridge

**Files:**
- Create: `src-tauri/src/runtime/claude/mod.rs`
- Create: `src-tauri/src/runtime/claude/command.rs`
- Create: `src-tauri/src/runtime/claude/projector.rs`
- Create: `src-tauri/src/runtime/claude/hook_server.rs`
- Create: `src-tauri/src/bin/okami-hook.rs`
- Create: `tests/fixtures/runtime/claude/session.jsonl`
- Create: `tests/fixtures/runtime/claude/tool-hook.json`
- Create: `src-tauri/tests/claude_projection.rs`
- Create: `src-tauri/tests/claude_hook_bridge.rs`
- Create: `src-tauri/tests/live_claude.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/runtime/registry.rs`

**Interfaces:**
- Consumes: `RuntimeAdapter`, `JsonlProcess`, `PolicyEngine`, `ApprovalBroker`.
- Produces: `ClaudeAdapter`, `ClaudeProjector`, per-session settings file, loopback-only Unix socket hook server, and `okami-hook` sidecar that returns official hook JSON without invoking another model.

- [ ] **Step 1: Write failing projector and hook authorization tests**

```rust
// src-tauri/tests/claude_hook_bridge.rs
#[tokio::test]
async fn pre_tool_use_waits_for_the_same_policy_broker_as_the_ui() {
    let harness = HookHarness::start().await;
    let request = fixture_json("tests/fixtures/runtime/claude/tool-hook.json");
    let pending = harness.send_hook(request);
    let approval = harness.next_approval().await.unwrap();
    harness.allow_once(approval.id).await.unwrap();
    assert_eq!(pending.await.unwrap()["hookSpecificOutput"]["permissionDecision"], "allow");
}
```

- [ ] **Step 2: Run focused suites and verify missing-adapter failures**

Run:

```bash
pnpm cargo:test --test claude_projection
pnpm cargo:test --test claude_hook_bridge
```

Expected: both fail because Claude modules and the hook sidecar are absent.

- [ ] **Step 3: Implement the version-probed command and hook bridge**

Use this exact argument contract for Claude `2.1.212`:

```rust
let args = [
    "--print", "--input-format", "stream-json", "--output-format", "stream-json",
    "--include-partial-messages", "--include-hook-events", "--replay-user-messages",
    "--chrome",
    "--permission-mode", "manual", "--settings", settings_path,
    "--session-id", session_id,
];
```

For an existing binding, replace `--session-id <new-id>` with `--resume <native-session-id>`; never pass both. The adapter records the `system/init.session_id` returned by Claude as the authoritative binding.

The generated settings file contains only the session's allowlisted workspaces and hooks. `PreToolUse` invokes the bundled `okami-hook` binary with a random per-session socket path and capability token passed by inherited environment, never command-line arguments. `okami-hook` sends one length-prefixed request to the Core, waits for allow/deny, emits the documented `hookSpecificOutput.permissionDecision`, and exits. `PostToolUse` emits result metadata but cannot grant authority. If the installed Claude version fails the capability probe, mark the adapter `degraded` and refuse write/execute tools; do not fall back to `--dangerously-skip-permissions`.

- [ ] **Step 4: Run fixture tests and an explicit one-turn live smoke**

Run:

```bash
pnpm cargo:test --test claude_projection --test claude_hook_bridge
OKAMI_RUN_LIVE_CLI_TESTS=1 OKAMI_LIVE_PROMPT='Reply with exactly OKAMI_CLAUDE_SMOKE' pnpm cargo:test --test live_claude -- --ignored --nocapture
```

Expected: fixture tests pass; live output first prints `Claude Code 2.1.212` and the active subscription auth source, then returns `OKAMI_CLAUDE_SMOKE`. It must not expose an API key in environment diagnostics or logs.

- [ ] **Step 5: Commit the Claude adapter and hook bridge**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/runtime/claude src-tauri/src/runtime/registry.rs src-tauri/src/bin/okami-hook.rs src-tauri/tests/claude_projection.rs src-tauri/tests/claude_hook_bridge.rs src-tauri/tests/live_claude.rs tests/fixtures/runtime/claude
git commit -m "feat: integrate Claude Code with policy hooks"
```

### Task 9: Orchestrate persistent lanes and deterministic delta synchronization

**Files:**
- Create: `src-tauri/src/orchestration/mod.rs`
- Create: `src-tauri/src/orchestration/lane_service.rs`
- Create: `src-tauri/src/orchestration/delta.rs`
- Create: `src-tauri/src/orchestration/run_service.rs`
- Create: `src-tauri/tests/lane_orchestration.rs`
- Modify: `src-tauri/src/db/lanes.rs`
- Modify: `src-tauri/src/db/events.rs`
- Modify: `src-tauri/src/runtime/adapter.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: repositories, runtime registry, native session IDs, policy engine.
- Produces: `LaneService::open`, `LaneService::send_turn`, `LaneService::switch`, `DeltaBuilder::build`, and `DeltaPackage` with objective, active decisions, Git state, artifacts, and event range.

- [ ] **Step 1: Write failing hot/stale/cold lane tests**

```rust
// src-tauri/tests/lane_orchestration.rs
#[tokio::test]
async fn hot_lane_with_no_delta_resumes_without_bootstrap() {
    let harness = LaneHarness::with_existing_session(RuntimeKind::Codex, "thread-123");
    let opened = harness.open_existing().await.unwrap();
    assert_eq!(opened.native_session_id.as_deref(), Some("thread-123"));
    assert!(opened.delta.is_none());
    assert_eq!(harness.runtime.resume_calls(), 1);
    assert_eq!(harness.runtime.start_calls(), 0);
}

#[tokio::test]
async fn stale_lane_receives_only_events_after_its_cursor() {
    let harness = LaneHarness::with_cursor(4).and_events(1..=7);
    let delta = harness.build_delta().unwrap();
    assert_eq!(delta.event_range, 5..=7);
    assert!(!delta.serialized.contains("sequence\":4"));
}
```

- [ ] **Step 2: Run the orchestration suite and verify it fails**

Run: `pnpm cargo:test --test lane_orchestration`

Expected: FAIL because `LaneService` and `DeltaBuilder` are missing.

- [ ] **Step 3: Implement state-machine transitions and canonical delta packages**

```rust
pub enum LaneTemperature { Hot, Stale, Cold, Clean }

pub struct DeltaPackage {
    pub schema_version: u16,
    pub task_id: TaskId,
    pub from_sequence_exclusive: u64,
    pub to_sequence_inclusive: u64,
    pub objective: String,
    pub constraints: Vec<String>,
    pub decisions: Vec<DecisionRef>,
    pub git: Option<GitSnapshot>,
    pub artifacts: Vec<ArtifactRef>,
    pub events: Vec<DeltaEvent>,
}
```

`open` resumes the native session whenever a binding exists. `DeltaBuilder` uses only persisted deterministic projections; it never calls a runtime. A cursor advances only after the target runtime accepts the delta. Switching lane writes `lane_switched` to audit and never closes the source lane.

- [ ] **Step 4: Run lane tests plus both adapter fixture suites**

Run:

```bash
pnpm cargo:test --test lane_orchestration
pnpm cargo:test --test codex_projection --test claude_projection
pnpm cargo:clippy
```

Expected: all pass; hot lane sends zero bootstrap bytes and stale lane contains only the expected sequence range.

- [ ] **Step 5: Commit lane orchestration**

```bash
git add src-tauri/src/orchestration src-tauri/src/db/lanes.rs src-tauri/src/db/events.rs src-tauri/src/runtime/adapter.rs src-tauri/src/lib.rs src-tauri/tests/lane_orchestration.rs
git commit -m "feat: orchestrate persistent runtime lanes"
```

### Task 10: Expose a narrow typed Tauri IPC facade

**Files:**
- Create: `src-tauri/src/app_state.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/tasks.rs`
- Create: `src-tauri/src/commands/lanes.rs`
- Create: `src-tauri/src/commands/runs.rs`
- Create: `src-tauri/src/commands/approvals.rs`
- Create: `src-tauri/src/commands/system.rs`
- Create: `src/lib/ipc/client.ts`
- Create: `src/lib/ipc/events.ts`
- Create: `src/lib/contracts/system.ts`
- Create: `src/lib/contracts/commands.ts`
- Create: `src/lib/ipc/client.test.ts`
- Create: `src/test/tauri-mock.ts`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Core services from Tasks 3–9.
- Produces: commands `system_doctor`, `task_create`, `task_list`, `lane_open`, `lane_send_turn`, `run_cancel`, `approval_resolve`, plus `workbench://event` notifications parsed by Zod before entering UI state.

- [ ] **Step 1: Write a failing typed-client test**

```ts
// src/lib/ipc/client.test.ts
import { beforeEach, expect, it } from "vitest";
import { installTauriMock } from "../../test/tauri-mock";
import { workbenchClient } from "./client";

beforeEach(() => installTauriMock({ system_doctor: { database: "ok", runtimes: [] } }));

it("validates command responses before returning them", async () => {
  await expect(workbenchClient.systemDoctor()).resolves.toEqual({ database: "ok", runtimes: [] });
  installTauriMock({ system_doctor: { database: 42, runtimes: [] } });
  await expect(workbenchClient.systemDoctor()).rejects.toThrow(/database/);
});
```

- [ ] **Step 2: Run the test and verify the missing-client failure**

Run: `pnpm test src/lib/ipc/client.test.ts`

Expected: FAIL with `Cannot find module './client'`.

- [ ] **Step 3: Compose AppState and implement the exact command boundary**

```rust
// src-tauri/src/commands/lanes.rs
#[tauri::command]
pub async fn lane_send_turn(
    state: tauri::State<'_, AppState>,
    request: SendTurnCommand,
) -> Result<RunSummary, CommandError> {
    request.validate()?;
    state.lanes.send_turn(request.into()).await.map_err(Into::into)
}
```

```ts
// src/lib/ipc/client.ts
async function invokeParsed<T>(command: string, args: unknown, schema: z.ZodType<T>): Promise<T> {
  const raw = await invoke<unknown>(command, args);
  return schema.parse(raw);
}

export const workbenchClient = {
  systemDoctor: () => invokeParsed("system_doctor", {}, systemDoctorSchema),
  sendTurn: (request: SendTurnRequest) => invokeParsed("lane_send_turn", { request }, runSummarySchema),
  resolveApproval: (request: ApprovalResolution) => invokeParsed("approval_resolve", { request }, approvalSchema),
};
```

```ts
// src/lib/contracts/system.ts
export const runtimeHealthSchema = z.object({
  runtime: z.enum(["claude", "codex"]),
  status: z.enum(["ready", "degraded", "unavailable"]),
  version: z.string().nullable(),
  detail: z.string().nullable(),
});
export const systemDoctorSchema = z.object({
  database: z.literal("ok"),
  runtimes: z.array(runtimeHealthSchema),
});
```

The command facade accepts no raw executable, arbitrary filesystem path, SQL, Keychain service, or provider token from the frontend. `AppState` composes dependencies but contains no business rules.

- [ ] **Step 4: Run frontend contracts and Rust command tests**

Run:

```bash
pnpm test src/lib/ipc/client.test.ts
pnpm typecheck
pnpm cargo:test commands::
pnpm cargo:clippy
```

Expected: all pass; malformed mock responses are rejected before state mutation.

- [ ] **Step 5: Commit the IPC facade**

```bash
git add src-tauri/src/app_state.rs src-tauri/src/commands src-tauri/src/lib.rs src/lib/ipc src/lib/contracts src/test/tauri-mock.ts
git commit -m "feat: expose typed workbench ipc"
```

### Task 11: Build the accessible Okami desktop shell

**Files:**
- Create: `src/app/router.tsx`
- Create: `src/app/providers.tsx`
- Create: `src/app/layout/AppShell.tsx`
- Create: `src/app/layout/NavigationRail.tsx`
- Create: `src/app/layout/Sidebar.tsx`
- Create: `src/app/layout/ContextPanel.tsx`
- Create: `src/components/Button.tsx`
- Create: `src/components/IconButton.tsx`
- Create: `src/components/StatusBadge.tsx`
- Create: `src/components/ResizablePane.tsx`
- Create: `src/app/layout/AppShell.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: typed IPC provider from Task 10.
- Produces: routes `/workbench`, `/quick-chat`, `/usage`, `/memory`, `/connections`; persistent navigation rail; collapsible sidebar/context panel; CSS tokens shared by every Phase 1 feature.

- [ ] **Step 1: Load `frontend-design`, inspect the Okami design system, and write the failing navigation test**

```tsx
// src/app/layout/AppShell.test.tsx
it("navigates with keyboard and exposes the active destination", async () => {
  renderApp("/workbench");
  const usage = screen.getByRole("link", { name: "Uso e limites" });
  usage.focus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByRole("heading", { name: "Uso e limites" })).toBeVisible();
  expect(usage).toHaveAttribute("aria-current", "page");
});
```

- [ ] **Step 2: Run the shell test and verify it fails**

Run: `pnpm test src/app/layout/AppShell.test.tsx`

Expected: FAIL because the router and shell do not exist.

- [ ] **Step 3: Implement the shell with Okami tokens and progressive disclosure**

```css
/* src/styles/tokens.css */
:root {
  color-scheme: dark;
  --ok-bg: #08090c;
  --ok-surface-1: #121318;
  --ok-surface-2: #181a20;
  --ok-surface-3: #202229;
  --ok-border: #2a2d35;
  --ok-text: #f2f2f4;
  --ok-text-muted: #9a9da6;
  --ok-orange: #ff7a1a;
  --ok-cyan: #68ddeb;
  --ok-green: #61cf8c;
  --ok-yellow: #f2c868;
  --ok-red: #fb6b75;
  --ok-radius-sm: 6px;
  --ok-radius-md: 9px;
  --ok-focus: 0 0 0 2px #08090c, 0 0 0 4px #68ddeb;
}
```

At widths below 1100px the context panel becomes a drawer; below 760px the text sidebar collapses but the rail remains. Every icon-only control has an accessible name and visible focus ring. The terminal is absent from default navigation and appears only inside an advanced drawer.

- [ ] **Step 4: Run unit, accessibility lint, and production build**

Run:

```bash
pnpm test src/app/layout/AppShell.test.tsx
pnpm lint
pnpm typecheck
pnpm build
```

Expected: all pass; no `jsx-a11y` warnings; route chunks build without circular imports.

- [ ] **Step 5: Commit the desktop shell**

```bash
git add src/app src/components src/styles
git commit -m "feat: build Okami desktop shell"
```

### Task 12: Render tasks, lanes, streaming conversation, and the composer

**Files:**
- Create: `src/features/workbench/api.ts`
- Create: `src/features/workbench/store.ts`
- Create: `src/features/workbench/WorkbenchPage.tsx`
- Create: `src/features/workbench/TaskSidebar.tsx`
- Create: `src/features/workbench/LaneSelector.tsx`
- Create: `src/features/workbench/Conversation.tsx`
- Create: `src/features/workbench/MessageBlock.tsx`
- Create: `src/features/workbench/Composer.tsx`
- Create: `src/features/workbench/RunStatus.tsx`
- Create: `src/features/workbench/WorkbenchPage.test.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/lib/ipc/events.ts`

**Interfaces:**
- Consumes: task/lane/run commands and canonical event stream.
- Produces: selected task/lane state, streaming message reducer keyed by `(runId, nativeEventId)`, explicit lane switch UI, cancel/interrupt control, and composer submissions.

- [ ] **Step 1: Write a failing streaming and lane-switch test**

```tsx
// src/features/workbench/WorkbenchPage.test.tsx
it("merges deltas once and preserves both lanes when the user switches", async () => {
  const runtime = renderWorkbenchFixture({ lanes: [claudeLane, codexLane] });
  runtime.emit(messageDelta("run-1", "msg-1", "Olá "));
  runtime.emit(messageDelta("run-1", "msg-1", "mundo"));
  expect(await screen.findByText("Olá mundo")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Mudar para Codex" }));
  expect(runtime.calls.laneOpen.at(-1)).toMatchObject({ laneId: codexLane.id });
  expect(runtime.calls.laneClose).toHaveLength(0);
});
```

- [ ] **Step 2: Run the feature test and verify it fails**

Run: `pnpm test src/features/workbench/WorkbenchPage.test.tsx`

Expected: FAIL because Workbench components and reducer are absent.

- [ ] **Step 3: Implement query state, event reduction, and explicit controls**

```ts
// src/features/workbench/store.ts
export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  selectedTaskId: null,
  selectedLaneId: null,
  streams: {},
  selectLane: (laneId) => set({ selectedLaneId: laneId }),
  applyEvent: (event) => set((state) => reduceCanonicalEvent(state, event)),
}));
```

```ts
export function reduceCanonicalEvent(state: WorkbenchState, event: CanonicalEvent): WorkbenchState {
  if (state.appliedEventIds[event.id]) return state;
  const next = { ...state, appliedEventIds: { ...state.appliedEventIds, [event.id]: true } };
  if (event.kind === "message_delta") {
    const key = `${event.runId}:${String(event.nativeEventId)}`;
    next.streams = { ...state.streams, [key]: `${state.streams[key] ?? ""}${String(event.payload.delta ?? "")}` };
  }
  if (event.kind === "run_completed" || event.kind === "run_failed") {
    next.runStatus = { ...state.runStatus, [event.runId]: event.kind === "run_completed" ? "completed" : "failed" };
  }
  return next;
}
```

The reducer ignores already-applied event IDs, appends deltas by native message ID, and marks a run complete only on `run_completed` or `run_failed`. The composer shows the selected harness, provider, model, permission mode, and workspace before send. Changing lane never sends a prompt; it only opens/resumes the selected native session and shows pending delta size.

- [ ] **Step 4: Run Workbench tests and frontend gates**

Run:

```bash
pnpm test src/features/workbench/WorkbenchPage.test.tsx
pnpm typecheck
pnpm lint
```

Expected: all pass; repeated event delivery does not duplicate text or tool cards.

- [ ] **Step 5: Commit task/lane conversation UI**

```bash
git add src/features/workbench src/app/router.tsx src/lib/ipc/events.ts
git commit -m "feat: add task and lane conversation ui"
```

### Task 13: Render native tools, diffs, terminal output, browser, HTML, subagents, and approvals

**Files:**
- Create: `src/features/workbench/events/EventCard.tsx`
- Create: `src/features/workbench/events/EventCardRegistry.tsx`
- Create: `src/features/workbench/events/CommandCard.tsx`
- Create: `src/features/workbench/events/FileCard.tsx`
- Create: `src/features/workbench/events/DiffCard.tsx`
- Create: `src/features/workbench/events/BrowserCard.tsx`
- Create: `src/features/workbench/events/HtmlPreviewCard.tsx`
- Create: `src/features/workbench/events/SubagentCard.tsx`
- Create: `src/features/workbench/events/ApprovalCard.tsx`
- Create: `src/features/workbench/advanced/TerminalDrawer.tsx`
- Create: `src/features/workbench/events/EventCards.test.tsx`
- Create: `src/features/workbench/events/HtmlPreviewCard.test.tsx`
- Modify: `package.json`
- Modify: `src/features/workbench/Conversation.tsx`

**Interfaces:**
- Consumes: canonical tool/approval/subagent events and approval IPC.
- Produces: progressive tool cards, sandboxed HTML preview, read-only terminal drawer, diff rendering, browser artifact rendering, and explicit approval decisions.

- [ ] **Step 1: Write failing renderer and sandbox tests**

```tsx
it("renders an approval without granting it implicitly", async () => {
  const runtime = renderEvent(approvalRequested({ command: "git push", risk: "external" }));
  expect(screen.getByText("git push")).toBeVisible();
  expect(runtime.calls.approvalResolve).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Permitir uma vez" }));
  expect(runtime.calls.approvalResolve).toEqual([{ resolution: "allow_once" }]);
});

it("sandboxes inline html without scripts or same-origin authority", () => {
  render(<HtmlPreviewCard html={'<script>top.location="https://evil.example"</script>'} />);
  const frame = screen.getByTitle("Prévia HTML");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
});
```

- [ ] **Step 2: Install rendering dependencies and verify tests fail**

Run:

```bash
pnpm add --save-exact @xterm/addon-fit@0.11.0 @xterm/xterm@6.0.0 diff2html@3.4.56
pnpm test src/features/workbench/events
```

Expected: dependencies install; tests fail because renderers do not exist.

- [ ] **Step 3: Implement a closed renderer registry and secure previews**

```tsx
const renderers: Partial<Record<CanonicalEvent["kind"], EventRenderer>> = {
  tool_call_started: ToolLifecycleCard,
  tool_call_updated: ToolLifecycleCard,
  tool_call_completed: ToolLifecycleCard,
  approval_requested: ApprovalCard,
  approval_resolved: ApprovalCard,
  subagent_started: SubagentCard,
  subagent_completed: SubagentCard,
};
```

Unknown events render a collapsed diagnostic card with redacted JSON. HTML `srcDoc` begins with `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">` and uses `sandbox=""`. Browser cards show runtime-provided URL/title/screenshot and route external opening through a leased Rust command. Terminal output is read-only by default; starting an interactive terminal requires a separate `terminal.exec` lease and a visible workspace path.

- [ ] **Step 4: Run event-card, security, and accessibility tests**

Run:

```bash
pnpm test src/features/workbench/events
pnpm lint
pnpm typecheck
```

Expected: all pass; no test triggers `approval_resolve` before a human click; script in preview cannot execute.

- [ ] **Step 5: Commit rich tool surfaces**

```bash
git add package.json pnpm-lock.yaml src/features/workbench
git commit -m "feat: render native workbench tool surfaces"
```

### Task 14: Add workspace-free quick chat with explicit context chips

**Files:**
- Create: `src/features/quick-chat/QuickChatPage.tsx`
- Create: `src/features/quick-chat/QuickChatComposer.tsx`
- Create: `src/features/quick-chat/ContextChips.tsx`
- Create: `src/features/quick-chat/quickChatService.ts`
- Create: `src/features/quick-chat/QuickChatPage.test.tsx`
- Create: `src-tauri/src/orchestration/quick_chat.rs`
- Create: `src-tauri/tests/quick_chat.rs`
- Modify: `src-tauri/src/commands/tasks.rs`
- Modify: `src/app/router.tsx`

**Interfaces:**
- Consumes: LaneService, task/conversation repositories, selected memory references.
- Produces: `quick_chat_create`, `quick_chat_send`, `ConversationKind::QuickChat`, null workspace binding, removable context references, and promotion to a normal task.

- [ ] **Step 1: Write failing no-workspace and context-minimization tests**

```rust
#[tokio::test]
async fn quick_chat_has_no_workspace_and_sends_only_selected_context() {
    let harness = QuickChatHarness::new();
    let chat = harness.create(RuntimeKind::Codex).await.unwrap();
    assert!(chat.workspace_id.is_none());
    harness.select_context(&chat.id, ["memory:note-7"]).await.unwrap();
    let request = harness.build_turn(&chat.id, "Resuma isso").await.unwrap();
    assert_eq!(request.context_refs, vec!["memory:note-7"]);
    assert!(!request.serialized.contains("memory:note-8"));
}
```

```tsx
it("removes a context chip before sending", async () => {
  const runtime = renderQuickChat({ chips: [emailChip, memoryChip] });
  await userEvent.click(screen.getByRole("button", { name: "Remover email atual" }));
  await userEvent.type(screen.getByRole("textbox"), "Resuma");
  await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
  expect(runtime.calls.quickChatSend[0].contextRefs).toEqual([memoryChip.ref]);
});
```

- [ ] **Step 2: Run Rust and React quick-chat tests and verify failures**

Run:

```bash
pnpm cargo:test --test quick_chat
pnpm test src/features/quick-chat/QuickChatPage.test.tsx
```

Expected: both fail because quick chat is not defined.

- [ ] **Step 3: Implement independent conversations and explicit promotion**

Quick chat creates a task row with `kind='quick_chat'`, no workspace, and a selected lane. It never auto-imports ChatGPT/Claude histories or project files. `Promote to task` creates a new normal task, copies only user-selected messages/context references, and records the source conversation ID in audit.

```rust
pub async fn build_turn(&self, request: QuickChatTurnRequest) -> Result<NativeTurnRequest, QuickChatError> {
    let chat = self.chats.get(request.conversation_id)?;
    if chat.workspace_id.is_some() { return Err(QuickChatError::UnexpectedWorkspace); }
    let context = self.context.resolve_selected(&request.context_refs)?;
    Ok(NativeTurnRequest {
        lane_id: chat.lane_id,
        user_content: request.content,
        context,
        workspace: None,
    })
}
```

- [ ] **Step 4: Run quick-chat and lane regression suites**

Run:

```bash
pnpm cargo:test --test quick_chat --test lane_orchestration
pnpm test src/features/quick-chat/QuickChatPage.test.tsx
pnpm typecheck
```

Expected: all pass; removing a chip prevents it from entering the native turn payload.

- [ ] **Step 5: Commit quick chat**

```bash
git add src/features/quick-chat src/app/router.tsx src-tauri/src/orchestration/quick_chat.rs src-tauri/src/commands/tasks.rs src-tauri/tests/quick_chat.rs
git commit -m "feat: add workspace free quick chat"
```

### Task 15: Implement Usage Control Center, quick popover, alerts, and preflight

**Files:**
- Create: `src-tauri/src/usage/mod.rs`
- Create: `src-tauri/src/usage/model.rs`
- Create: `src-tauri/src/usage/repository.rs`
- Create: `src-tauri/src/usage/codex.rs`
- Create: `src-tauri/src/usage/claude.rs`
- Create: `src-tauri/src/usage/activity.rs`
- Create: `src-tauri/src/usage/preflight.rs`
- Create: `src-tauri/tests/usage_collectors.rs`
- Create: `tests/fixtures/usage/codex-rate-limits.json`
- Create: `tests/fixtures/usage/claude-usage.txt`
- Create: `src/features/usage/contracts.ts`
- Create: `src/features/usage/UsagePage.tsx`
- Create: `src/features/usage/UsageSummary.tsx`
- Create: `src/features/usage/SubscriptionTable.tsx`
- Create: `src/features/usage/UsageDetail.tsx`
- Create: `src/features/usage/UsageQuickPopover.tsx`
- Create: `src/features/usage/UsagePage.test.tsx`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/commands/lanes.rs`
- Modify: `src/features/workbench/LaneSelector.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: Codex client, Claude executable, canonical events, usage tables, lane health/capabilities.
- Produces: `UsageCollector`, `UsageSnapshot`, `UsageSourceKind`, `UsageFreshness`, `ActivityAggregator`, `PreflightService::evaluate`, commands `usage_overview`, `usage_refresh`, `usage_alert_set`, and UI views for subscriptions/runtimes/models.

- [ ] **Step 1: Write failing source-integrity and UI-separation tests**

```rust
// src-tauri/tests/usage_collectors.rs
#[test]
fn stale_presentational_data_never_becomes_an_official_snapshot() {
    let parsed = ClaudeUsageParser::for_version("2.1.212")
        .parse(include_str!("../../tests/fixtures/usage/claude-usage.txt"))
        .unwrap();
    assert_eq!(parsed.source.kind, UsageSourceKind::NativePresentational);
    assert_eq!(parsed.windows[0].remaining_percent, Some(83.0));
    let stale = parsed.with_collected_at("2026-07-16T10:00:00Z").at("2026-07-17T10:00:00Z");
    assert_eq!(stale.freshness, UsageFreshness::Stale);
    assert_ne!(stale.source.kind, UsageSourceKind::OfficialStructured);
}
```

```tsx
// src/features/usage/UsagePage.test.tsx
it("labels quota, session context, and local activity as separate measures", () => {
  renderUsageFixture();
  expect(screen.getByRole("columnheader", { name: "Quota da assinatura" })).toBeVisible();
  expect(screen.getByText("Contexto desta sessão")).toBeVisible();
  expect(screen.getByText("Atividade local")).toBeVisible();
  expect(screen.getByText("Leitura local")).toBeVisible();
});
```

- [ ] **Step 2: Add PTY support and verify both suites fail**

Add:

```toml
portable-pty = "=0.9.0"
```

Run:

```bash
pnpm cargo:test --test usage_collectors
pnpm test src/features/usage/UsagePage.test.tsx
```

Expected: both fail because collectors and Usage UI are undefined.

- [ ] **Step 3: Implement collectors, immutable snapshots, activity buckets, and preflight**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UsageSourceKind {
    OfficialStructured,
    NativePresentational,
    DashboardRead,
    LocalEstimate,
    Unavailable,
}

pub struct UsageWindow {
    pub window_kind: UsageWindowKind,
    pub model_group: Option<String>,
    pub used_percent: Option<f64>,
    pub remaining_percent: Option<f64>,
    pub resets_at: Option<DateTime<Utc>>,
}
```

Codex uses `account/rateLimits/read` and `account/usage/read`; it is `OfficialStructured`. Claude runs the native `/usage` command in a short-lived PTY only when the user refreshes or the TTL expires; it is `NativePresentational`, strips ANSI, and parses only versioned fixtures. Parser mismatch stores an error and preserves the prior snapshot as `stale`. Activity aggregation consumes persisted canonical usage events and never writes quota percentages.

`PreflightService` filters by task capability and runtime health before considering quota freshness. It returns ranked suggestions with reasons but no executable switch. `lane_send_turn` blocks only when policy says `hard_stop`; low or unavailable quota produces a confirmation warning. Automatic switching does not exist in Phase 1.

```rust
pub fn evaluate(&self, request: &PreflightRequest) -> Result<PreflightReport, UsageError> {
    let mut candidates = self.lanes.compatible_with(&request.required_capabilities)?;
    candidates.retain(|lane| lane.health != RuntimeHealthStatus::Unavailable);
    let suggestions = candidates.into_iter().map(|lane| {
        let snapshot = self.snapshots.latest_for_account(&lane.provider_account)?;
        Ok(LaneSuggestion::from_health_capability_and_snapshot(lane, snapshot))
    }).collect::<Result<Vec<_>, UsageError>>()?;
    Ok(PreflightReport {
        current_lane: request.lane_id,
        warning: warning_for_current_lane(&suggestions, request.lane_id),
        suggestions,
        automatic_switch: None,
    })
}
```

- [ ] **Step 4: Run collector, UI, orchestration, and no-inference tests**

Run:

```bash
pnpm cargo:test --test usage_collectors --test lane_orchestration
pnpm test src/features/usage/UsagePage.test.tsx
pnpm typecheck
pnpm lint
```

Expected: all pass; test spies confirm refresh starts only Codex app-server or Claude PTY and never calls `send_turn`.

- [ ] **Step 5: Commit usage and preflight**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/usage src-tauri/src/commands src-tauri/tests/usage_collectors.rs tests/fixtures/usage src/features/usage src/features/workbench/LaneSelector.tsx src/app/router.tsx
git commit -m "feat: add honest usage control center"
```

### Task 16: Index selected Obsidian folders into local FTS5 without model calls

**Files:**
- Create: `src-tauri/src/memory/mod.rs`
- Create: `src-tauri/src/memory/config.rs`
- Create: `src-tauri/src/memory/scanner.rs`
- Create: `src-tauri/src/memory/indexer.rs`
- Create: `src-tauri/src/memory/search.rs`
- Create: `src-tauri/src/memory/watcher.rs`
- Create: `src-tauri/tests/obsidian_memory.rs`
- Create: `tests/fixtures/obsidian/Claude Code/Projetos/okami.md`
- Create: `tests/fixtures/obsidian/Claude Code/Contextos/security.md`
- Create: `src/features/quick-chat/MemoryPicker.tsx`
- Create: `src/features/quick-chat/MemoryPicker.test.tsx`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src/features/quick-chat/ContextChips.tsx`

**Interfaces:**
- Consumes: SQLCipher FTS5 tables, quick-chat context references.
- Produces: `MemoryConfig`, `ObsidianIndexer::full_sync`, `ObsidianWatcher`, `MemorySearch::query`, commands `memory_configure`, `memory_search`, `memory_reindex`, and cited result chips.

- [ ] **Step 1: Write failing path-scope and provenance tests**

```rust
// src-tauri/tests/obsidian_memory.rs
#[test]
fn indexer_reads_only_allowed_markdown_and_returns_provenance() {
    let harness = MemoryHarness::from_fixture("tests/fixtures/obsidian");
    harness.allow("Claude Code/Projetos").unwrap();
    harness.full_sync().unwrap();
    let results = harness.search("subscription gateway").unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0].path.ends_with("Claude Code/Projetos/okami.md"));
    assert!(results[0].citation.contains("okami.md"));
    assert!(harness.search("private key fixture").unwrap().is_empty());
}
```

- [ ] **Step 2: Add stable filesystem dependencies and verify the test fails**

Add:

```toml
globset = "=0.4.19"
ignore = "=0.4.30"
notify = "=8.2.0"
pulldown-cmark = "=0.13.4"
```

Run: `pnpm cargo:test --test obsidian_memory`

Expected: FAIL because memory modules are absent.

- [ ] **Step 3: Implement scoped scan, redaction, FTS projection, watcher, and picker**

The default suggested vault is `/Users/marcos/Documents/Obsidian/Marcos`, but no folder is indexed until selected. Rules are explicit `read`, `read_write`, `read_only_for_models`, or `excluded`; Phase 1 supports read and excluded behavior only. Ignore hidden folders, binary files, `.trash`, `.git`, files above 2 MiB, and lines matching credential/private-key detectors. Store path, content hash, modified time, title, frontmatter JSON, plain text, and source scope. Search uses FTS5/BM25 plus deterministic recency; every result contains path, heading, line excerpt, and score.

`MemoryPicker` searches locally and adds references only after a click. The selected note text is resolved immediately before a turn and appears as a removable chip; a search result alone never enters model context.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryScope {
    pub root: PathBuf,
    pub relative_path: PathBuf,
    pub access: MemoryAccess,
}

pub fn is_indexable(scope: &MemoryScope, path: &Path, metadata: &Metadata) -> bool {
    scope.access == MemoryAccess::Read
        && path.starts_with(scope.root.join(&scope.relative_path))
        && path.extension().and_then(OsStr::to_str) == Some("md")
        && metadata.len() <= 2 * 1024 * 1024
        && !path.components().any(|part| matches!(part.as_os_str().to_str(), Some(".git" | ".trash")))
}
```

- [ ] **Step 4: Run indexing, watcher, picker, and quick-chat regressions**

Run:

```bash
pnpm cargo:test --test obsidian_memory
pnpm test src/features/quick-chat/MemoryPicker.test.tsx src/features/quick-chat/QuickChatPage.test.tsx
pnpm cargo:clippy
pnpm typecheck
```

Expected: all pass; changing one fixture reindexes one document; excluded/security fixture never appears in results.

- [ ] **Step 5: Commit basic Obsidian memory**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/memory src-tauri/src/commands src-tauri/tests/obsidian_memory.rs tests/fixtures/obsidian src/features/quick-chat
git commit -m "feat: index selected Obsidian memory"
```

### Task 17: Reconcile interrupted runs, approvals, cursors, and audit after restart

**Files:**
- Create: `src-tauri/src/orchestration/recovery.rs`
- Create: `src-tauri/src/audit/mod.rs`
- Create: `src-tauri/src/audit/redaction.rs`
- Create: `src-tauri/src/audit/export.rs`
- Create: `src-tauri/tests/restart_recovery.rs`
- Create: `src-tauri/tests/audit_redaction.rs`
- Modify: `src-tauri/src/app_state.rs`
- Modify: `src-tauri/src/db/runs.rs`
- Modify: `src-tauri/src/db/events.rs`
- Modify: `src-tauri/src/runtime/supervisor.rs`

**Interfaces:**
- Consumes: persisted runs/events/cursors/approvals and runtime native session bindings.
- Produces: `RecoveryService::reconcile_startup`, `RecoveryReport`, `AuditExporter`, redacted JSONL export, and UI-safe recovery notifications.

- [ ] **Step 1: Write failing crash-recovery and secret-redaction tests**

```rust
// src-tauri/tests/restart_recovery.rs
#[tokio::test]
async fn startup_marks_orphans_interrupted_without_replaying_tools() {
    let harness = RecoveryHarness::with_running_run_and_completed_tool();
    let report = harness.restart().await.unwrap();
    assert_eq!(report.interrupted_runs, 1);
    assert_eq!(harness.tool_execution_count(), 0);
    assert_eq!(harness.run_status(), RunStatus::Interrupted);
    assert_eq!(harness.resume_cursor(), 9);
}
```

```rust
#[test]
fn audit_export_redacts_credentials_and_preserves_decision_metadata() {
    let output = export_fixture(json!({"token":"sk-secret", "decision":"allow_once"}));
    assert!(!output.contains("sk-secret"));
    assert!(output.contains("[REDACTED]"));
    assert!(output.contains("allow_once"));
}
```

- [ ] **Step 2: Run focused suites and verify they fail**

Run:

```bash
pnpm cargo:test --test restart_recovery --test audit_redaction
```

Expected: FAIL because recovery and audit export modules are absent.

- [ ] **Step 3: Implement deterministic startup reconciliation and redaction**

At startup, one transaction changes `starting|running|waiting_approval` runs with no live owned process to `interrupted`, expires orphan approvals, preserves last committed cursor, and emits one `run_interrupted` audit record. It never replays a command/tool. Opening the lane later uses the runtime's native resume; if native resume fails, UI offers a new cold lane with a visible delta package.

Redaction walks JSON recursively and masks key names matching `token|secret|password|authorization|cookie|private_key`, bearer/JWT/API-key patterns in strings, and configured filesystem paths. Export writes append-only JSONL to a user-selected location through a leased Rust command.

```rust
pub fn reconcile_startup(&self, now: DateTime<Utc>) -> Result<RecoveryReport, RecoveryError> {
    let live = self.supervisor.live_owned_run_ids();
    self.db.with_transaction(|tx| {
        let candidates = self.runs.incomplete_in(tx)?;
        let mut interrupted = 0;
        for run in candidates.into_iter().filter(|run| !live.contains(&run.id)) {
            interrupted += self.runs.mark_interrupted(tx, run.id, now)?;
        }
        let expired = tx.execute(
            "UPDATE approvals SET status='expired', resolved_at=?1
             WHERE status='pending'",
            [now.to_rfc3339()],
        )?;
        self.audit_interrupted_once(tx, now)?;
        Ok(RecoveryReport { interrupted_runs: interrupted, expired_approvals: expired })
    })
}
```

- [ ] **Step 4: Run recovery plus repository/idempotency regressions**

Run:

```bash
pnpm cargo:test --test restart_recovery --test audit_redaction --test repositories
pnpm cargo:clippy
```

Expected: all pass; two consecutive recoveries produce one interruption audit entry and zero tool re-executions.

- [ ] **Step 5: Commit recovery and audit**

```bash
git add src-tauri/src/orchestration/recovery.rs src-tauri/src/audit src-tauri/src/app_state.rs src-tauri/src/db src-tauri/src/runtime/supervisor.rs src-tauri/tests/restart_recovery.rs src-tauri/tests/audit_redaction.rs
git commit -m "feat: recover interrupted work safely"
```

### Task 18: Prove the Phase 1 gate visually, end-to-end, and as a macOS bundle

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/workbench.spec.ts`
- Create: `tests/e2e/usage.spec.ts`
- Create: `tests/e2e/quick-chat.spec.ts`
- Create: `tests/e2e/visual-layout.spec.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `scripts/doctor.sh`
- Create: `scripts/live-phase1-smoke.sh`
- Create: `scripts/release-gate.sh`
- Create: `src-tauri/tests/live_phase1.rs`
- Create: `src-tauri/tests/support/live.rs`
- Create: `docs/qa/phase-1-evidence.md`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: complete Phase 1 application.
- Produces: deterministic mocked-webview E2E suite, visual screenshots, accessibility scan, opt-in real CLI smoke, doctor report, release gate, `.app`, and `.dmg` candidate.

- [ ] **Step 1: Load `frontend-design`, then write failing end-to-end acceptance tests**

```ts
// tests/e2e/workbench.spec.ts
test("switches Claude to Codex without closing either native lane", async ({ page }) => {
  await installWorkbenchFixture(page, "two-hot-lanes");
  await page.goto("/workbench");
  await page.getByRole("button", { name: "Mudar para Codex" }).click();
  await expect(page.getByText("Lane Codex retomada")).toBeVisible();
  await expect(page.getByText("0 eventos para sincronizar")).toBeVisible();
  expect(await collectedCalls(page, "lane_close")).toHaveLength(0);
});
```

```ts
// tests/e2e/visual-layout.spec.ts
for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 760, height: 900 }]) {
  test(`has no overlap at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/usage");
    await expectNoHorizontalOverflow(page);
    await expectNoElementOverlap(page, ["main", "nav", "[data-usage-popover]"]);
  });
}
```

- [ ] **Step 2: Install accessibility tooling and verify the E2E suite fails**

Run:

```bash
pnpm add --save-dev --save-exact @axe-core/playwright@4.12.1
PLAYWRIGHT_BROWSERS_PATH=$PWD/.cache/ms-playwright pnpm exec playwright install chromium
pnpm test:e2e
```

Expected: tests fail because fixture helpers, release scripts, and final routes are not fully wired.

- [ ] **Step 3: Implement fixtures, doctor, real smoke, and release gate**

`scripts/doctor.sh` must report OS/architecture, Node/pnpm/Rust/Xcode versions, SQLCipher availability, writable repository caches, installed Claude/Codex versions, subscription-auth status, and whether live tests are enabled. It prints no credential values.

`scripts/live-phase1-smoke.sh` must require `OKAMI_RUN_LIVE_CLI_TESTS=1`, create a unique workspace under `${TMPDIR}`, initialize Git there, and print every quota-consuming turn before execution. The sequence is fixed:

1. open a Claude lane and ask it to create `claude.txt` containing `CLAUDE_LANE_OK`;
2. switch to a Codex lane and ask it to read that file and create `codex.txt` containing `CODEX_SAW_CLAUDE`;
3. switch back to Claude, resume the original native session, and ask it to confirm only the new Codex delta;
4. refresh usage, verify every value has source/freshness, and verify no hidden run exists;
5. stop/restart the app core, reopen the task, and confirm both native session bindings and audit entries remain.

`scripts/release-gate.sh` runs `pnpm check`, Playwright, doctor, secret scan over tracked files, `git diff --check`, then `pnpm exec tauri build --bundles app,dmg --no-sign` for the local candidate. Code signing/notarization credentials are a separate explicit release step and never committed.

```bash
#!/usr/bin/env bash
# scripts/doctor.sh
set -euo pipefail
printf 'macOS=%s arch=%s\n' "$(sw_vers -productVersion)" "$(uname -m)"
printf 'node=%s pnpm=%s rustc=%s\n' "$(node --version)" "$(pnpm --version)" "$(rustc --version)"
printf 'claude=%s\n' "$(claude --version | head -1)"
printf 'codex=%s\n' "$(codex --version | tail -1)"
test -w .cache || { printf 'repository cache is not writable\n' >&2; exit 1; }
pnpm cargo:test database_is_sqlcipher_encrypted_and_migrated -- --exact
```

```bash
#!/usr/bin/env bash
# scripts/live-phase1-smoke.sh
set -euo pipefail
test "${OKAMI_RUN_LIVE_CLI_TESTS:-0}" = "1" || {
  printf 'Refusing to consume subscription quota without OKAMI_RUN_LIVE_CLI_TESTS=1\n' >&2
  exit 2
}
workspace="$(mktemp -d "${TMPDIR:-/tmp}/okami-phase1.XXXXXX")"
printf 'Live workspace: %s\n' "$workspace"
git -C "$workspace" init
OKAMI_LIVE_WORKSPACE="$workspace" CARGO_HOME=$PWD/.cache/cargo cargo test --manifest-path src-tauri/Cargo.toml --test live_phase1 -- --ignored --nocapture
```

```rust
// src-tauri/tests/live_phase1.rs
#[tokio::test]
#[ignore = "consumes Claude and Codex subscription quota"]
async fn claude_codex_claude_continuity_survives_restart() {
    assert_eq!(std::env::var("OKAMI_RUN_LIVE_CLI_TESTS").as_deref(), Ok("1"));
    let workspace = PathBuf::from(std::env::var("OKAMI_LIVE_WORKSPACE").unwrap());
    let mut harness = LivePhaseOneHarness::start(workspace.clone()).await.unwrap();
    eprintln!("TURN 1/3 Claude: create claude.txt with CLAUDE_LANE_OK");
    let claude = harness.turn(RuntimeKind::Claude, "Create claude.txt containing exactly CLAUDE_LANE_OK").await.unwrap();
    eprintln!("TURN 2/3 Codex: read claude.txt and create codex.txt");
    harness.turn(RuntimeKind::Codex, "Read claude.txt and create codex.txt containing exactly CODEX_SAW_CLAUDE").await.unwrap();
    eprintln!("TURN 3/3 Claude resume: inspect only the Codex delta");
    harness.resume(claude.lane_id, "Confirm the new Codex delta without rewriting either file").await.unwrap();
    harness.assert_no_hidden_runs().unwrap();
    harness.restart().await.unwrap();
    harness.assert_native_binding(claude.lane_id).unwrap();
    assert_eq!(std::fs::read_to_string(workspace.join("claude.txt")).unwrap(), "CLAUDE_LANE_OK");
    assert_eq!(std::fs::read_to_string(workspace.join("codex.txt")).unwrap(), "CODEX_SAW_CLAUDE");
}
```

```bash
#!/usr/bin/env bash
# scripts/release-gate.sh
set -euo pipefail
pnpm check
pnpm test:e2e
./scripts/doctor.sh
git diff --check
pnpm exec tauri build --bundles app,dmg --no-sign
```

- [ ] **Step 4: Run all automated gates, visual review, native smoke, and bundle build**

Run:

```bash
pnpm check
pnpm test:e2e
PLAYWRIGHT_BROWSERS_PATH=$PWD/.cache/ms-playwright pnpm exec playwright test tests/e2e/visual-layout.spec.ts --update-snapshots
./scripts/doctor.sh
OKAMI_RUN_LIVE_CLI_TESTS=1 ./scripts/live-phase1-smoke.sh
./scripts/release-gate.sh
```

Expected:

- frontend, Rust, contract, policy, adapter fixture, recovery, and E2E suites pass;
- Axe reports zero serious or critical violations;
- screenshots at all three viewports show no overlap, clipped controls, lost focus, or unreadable contrast;
- live smoke proves Claude → Codex → Claude continuity with exactly three visible user turns and no auxiliary run;
- `.cache/target/release/bundle/macos/Okami Workbench.app` and a DMG candidate exist;
- `docs/qa/phase-1-evidence.md` records commands, versions, timestamps, screenshots, native session IDs redacted to prefixes, and pass/fail evidence.

- [ ] **Step 5: Commit the verified Phase 1 release candidate**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts tests/e2e scripts src-tauri/tests/live_phase1.rs src-tauri/tests/support/live.rs src-tauri/tauri.conf.json docs/qa/phase-1-evidence.md
git commit -m "test: prove Okami Workbench phase one"
```

## Phase 1 Spec Coverage Map

| Specification requirement | Implemented and proven by |
|---|---|
| Tauri + React + Rust, local-only privileged core | Tasks 1, 3, 10 |
| Claude Code and Codex subscription runtimes | Tasks 6–8, 18 |
| Persistent native lanes and delta-only switching | Task 9; live proof in Task 18 |
| Chat-native UI without terminal-first presentation | Tasks 11–13 |
| Native browser, HTML, files, diffs, terminal, approvals, subagents | Adapter fixtures in Tasks 7–8; renderers and security tests in Task 13 |
| Global quick chat without workspace | Task 14 |
| Honest usage, activity, alerts, and preflight | Task 15 |
| SQLCipher, FTS5, Keychain, leases, audit | Tasks 3–5, 17 |
| Basic read-only Obsidian indexing with provenance | Task 16 |
| Restart recovery without duplicate actions | Task 17; native restart proof in Task 18 |
| Visual, responsive, accessible macOS experience | Tasks 11, 13, 15, 18 |

## Full Phase 1 Definition of Done

- A real task starts in Claude, continues in Codex, and resumes in the original Claude session without a hidden model call.
- Hot lanes send no bootstrap; stale lanes send only the deterministic event delta.
- Browser/HTML/files/diffs/terminal/subagent/approval events are visible as chat-native components; terminal remains advanced.
- Every privileged action is allowed by a live lease or a single-use approval recorded in audit.
- Quick chats are independent conversations without implicit workspace context.
- Usage UI distinguishes subscription quota, session context, and local activity, and shows source/freshness for every value.
- Codex structured usage and Claude native presentational usage degrade to stale/unavailable instead of fabricating percentages.
- Selected Obsidian notes are retrieved locally with path/heading provenance and enter a prompt only as visible removable chips.
- Restart recovery produces no duplicate event, tool execution, approval, or external action.
- Automated, visual, accessibility, live subscription, and bundle gates have evidence in `docs/qa/phase-1-evidence.md`.

## Implementation References

- [Tauri 2 create-project guide](https://v2.tauri.app/start/create-project/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [rusqlite SQLCipher build features](https://docs.rs/rusqlite/latest/rusqlite/)
- [SQLite FTS5](https://sqlite.org/fts5.html)

## Execution Handoff

Plan execution must use one of these modes:

1. **Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`; dispatch a fresh implementation worker per task, review specification compliance and code quality between tasks, and allow at most two implementation attempts per task. If the second attempt still fails, the coordinating agent assumes the task and finishes it directly. Reviewers stay inside the task brief; broad criticism, speculative rewrites, or overengineering are grounds for the coordinator to stop the agent and complete the scoped work.
2. **Inline Execution:** use `superpowers:executing-plans`; execute tasks in small batches with a checkpoint after every sprint.

Do not begin Phase 2 until the complete Phase 1 definition of done passes with real Claude and Codex subscription sessions.
