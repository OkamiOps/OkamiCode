# Okami Workbench Phase 1 Implementation Plan (Electron)

> **For agentic workers:** REQUIRED SUB-SKILL: Use the Codex-Driven mode described in Execution Handoff (user-selected), falling back to superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a bundle-ready macOS desktop application in which Marcos can run and resume real Claude Code and Codex subscription sessions through one chat-native UI, inspect native tools and approvals, switch persistent lanes without an auxiliary model, search local Obsidian context, and see honest usage data.

**Architecture:** An Electron app written in TypeScript end to end. The **main process** is the trusted core: encrypted SQLite state, key material via `safeStorage` (macOS Keychain-backed), process supervision of the Claude Code and Codex CLIs, policy enforcement, event normalization, lane synchronization, usage collection, and memory retrieval. The **renderer** is a sandboxed React UI (`contextIsolation: true`, `nodeIntegration: false`) that receives typed projections through a narrow `contextBridge` preload API validated with Zod on both sides. Claude Code and Codex remain the actual harnesses; every normalized event retains its native reference for audit.

**Tech Stack:** macOS 26 arm64, Node.js 24.17.0, pnpm, Electron (latest stable), electron-vite, electron-builder, React 19, TypeScript, Zod, Zustand, TanStack Query, HeroUI 3 + Tailwind CSS 4, better-sqlite3-multiple-ciphers (SQLCipher), node-pty, Vitest, Testing Library, Playwright (`_electron`).

---

## Global Constraints

- Initial target is macOS 26 on Apple Silicon; do not broaden this plan to Windows or Linux.
- Phase 1 includes only the daily Workbench: Claude Code, Codex, lanes, native tool surfaces, global quick chat, Usage Control Center, SQLCipher/FTS5, basic read-only Obsidian indexing, leases, audit, and restart recovery.
- Do not implement email, WhatsApp, calendar, Kanban/Todoist, Grok, Cursor, AGY, OpenCode, MiniMax, MiMo, Holographic/HRR, GBrain, or persistent automation in this plan (they are Phase 2+).
- A run has exactly one executor. No hidden supervisory model, summarization model, paid API fallback, or silent provider switch is permitted.
- Claude and Codex must use the user's installed CLI subscription authentication. Tests must never inject `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
- **Unified harness is the product default (spec §7.1):** selecting a non-Claude model runs the Claude Code harness pointed at that provider's subscription through the local Subscription Gateway (Task 19). Claude quota is consumed only by Claude models. Gateway profiles for non-Claude providers must never contain Anthropic credentials; a bridge failure pauses the lane and offers the native runtime — it never reroutes to the Claude subscription.
- Default live CLI versions for fixtures are Claude Code `2.1.212` and Codex CLI `0.144.5`; adapters must probe versions and degrade explicitly when an unsupported protocol is detected.
- All privileged operations live in the main process. The renderer runs sandboxed with `contextIsolation: true` and `nodeIntegration: false`; it cannot spawn processes, touch the filesystem, read key material, or open the database. The preload exposes only the enumerated `okami` API defined in Task 10.
- Store the database key only via Electron `safeStorage` (Keychain-backed). Store operational data in SQLCipher. Redact native payloads before logs, fixtures, or audit exports.
- Dependency versions: Task 1 installs every dependency with `pnpm add --save-exact` so the lockfile pins exact versions; later tasks never change a pinned major without an explicit note in the commit message.
- Keep modules focused: target 250 lines and split any production source file before 400 lines.
- Frontend tasks must load the `frontend-design` skill and use the Okami design system at `https://okamiops.com/design-system/`; validate contrast, overlap, responsive behavior, keyboard flow, focus, and CSS application visually.
- Frontend tasks must also follow the canonical five-region layout (nav rail, sectioned sidebar, list pane, focal content, details panel) defined in `docs/superpowers/specs/2026-07-18-okami-workbench-layout-reference.md`. The screenshot reference governs structure and density only; every color, font, radius, and focus style comes from Okami tokens.
- **Visual acceptance reference (user-mandated 2026-07-18):** `docs/design/okami-workbench-mockup.html` is the user-approved mockup. Every UI task must open it side by side with the implemented screen and match its component treatment — list items (avatar/icon 32px + title + one-line preview + unread/status badges), conversation bubbles (incoming neutral left / outgoing accent right with timestamps), sectioned sidebar with counters and lane rows with route badges, dense `label: value` details groups with tabs, topbar usage chips. A screen that is functionally correct but visually unlike the mockup does NOT pass its task gate.
- Use HeroUI 3 primitives and Lucide icons before introducing custom interactive components or bespoke icons. Keep Okami identity in a thin theme/token layer.
- Prefer established libraries over bespoke code across the frontend (user directive): HeroUI for interactive components, Recharts or Nivo for charts/heatmaps in the Usage Control Center, diff2html for diffs, @xterm/xterm for terminal output, react-markdown for message rendering. Write custom components only when no maintained library fits; the goal is less code to review and fewer tokens spent regenerating UI plumbing.
- Comments explain non-obvious invariants, protocol quirks, or security boundaries only; never restate self-explanatory code.
- Use a repository-local pnpm store (`.npmrc` → `store-dir=.cache/pnpm`); nothing is written to the user's global caches.
- Default tests must not consume subscription quota. Live adapter and end-to-end tests run only with `OKAMI_RUN_LIVE_CLI_TESTS=1` and must print the selected runtime/model before sending a turn.
- Every task finishes with its focused tests, the relevant full gate, and one commit. Do not combine tasks into a giant commit.

## Delivery Sprints

| Sprint | Tasks | Reviewable outcome |
|---|---|---|
| 0 — Foundation | 1–3 | App boots, contracts are stable, encrypted state opens safely |
| 1 — Trusted core | 4–6 | Events persist, leases gate actions, process transport survives cancellation |
| 2 — Real runtimes | 7–9, 19 | Codex and Claude run natively; the gateway routes GPT through the Claude harness on ChatGPT quota; lanes resume and sync only deltas |
| 3 — Desktop experience | 10–14 | Okami shell, chat, tool surfaces, approvals, quick chat |
| 4 — Usage and memory | 15–16 | Honest limits/activity and read-only Obsidian retrieval |
| 5 — Recovery and release | 17–18 | Restart recovery, audit, visual/E2E proof, bundle-ready `.app`/DMG candidate |

## Planned File Map

```text
.
├── .nvmrc / .npmrc                       # toolchain pin and local pnpm store
├── package.json                          # scripts and exact-pinned dependencies
├── electron.vite.config.ts               # main/preload/renderer build config
├── electron-builder.yml                  # .app/.dmg packaging
├── playwright.config.ts                  # Electron E2E suite
├── src/shared/                           # single source of truth for contracts
│   ├── contracts/                        # Zod schemas + inferred types (events, lanes, ipc)
│   └── ids.ts                            # branded UUID id helpers
├── src/main/                             # trusted core (Electron main process)
│   ├── index.ts                          # app bootstrap, window creation, wiring only
│   ├── db/                               # SQLCipher open, migrations, repositories
│   ├── secrets.ts                        # safeStorage-backed database key
│   ├── policy/                           # leases, approvals, deterministic authorize
│   ├── runtime/                          # JSONL transport, supervisor, codex/, claude/
│   ├── gateway/                          # Subscription Gateway: profiles, routes, chatgpt bridge
│   ├── orchestration/                    # lanes, delta builder, quick chat, recovery
│   ├── usage/                            # collectors, snapshots, activity, preflight
│   ├── memory/                           # Obsidian scanner, FTS5 indexer, watcher
│   ├── audit/                            # audit log, redaction, export
│   └── ipc/                              # ipcMain handlers (narrow facade)
├── src/preload/index.ts                  # contextBridge: enumerated okami API only
├── src/renderer/                         # sandboxed React UI
│   ├── app/                              # router, providers, five-region AppShell
│   ├── components/                       # shared primitives on HeroUI
│   ├── features/workbench/               # tasks, lanes, conversation, tool cards
│   ├── features/quick-chat/              # workspace-free conversations
│   ├── features/usage/                   # Usage Control Center and popover
│   ├── lib/ipc/                          # typed client over window.okami
│   └── styles/                           # Okami tokens and global rules
├── bin/okami-hook.mjs                    # Claude hook bridge (no inference)
├── tests/fixtures/                       # sanitized native protocol fixtures
├── tests/e2e/                            # Playwright _electron flows
└── scripts/                              # doctor, live smoke, release gate
```

### Task 1: Scaffold the Electron application and quality gates

**Files:**
- Create: `.nvmrc`, `.npmrc`, `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `electron.vite.config.ts`, `eslint.config.js`, `vitest.config.ts`
- Create: `index.html`, `src/renderer/main.tsx`, `src/renderer/app/App.tsx`, `src/renderer/app/App.test.tsx`
- Create: `src/renderer/styles/tokens.css`, `src/renderer/styles/global.css`
- Create: `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/main/window.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing frontend boot test**

```tsx
// src/renderer/app/App.test.tsx
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

- [ ] **Step 2: Scaffold with electron-vite and pin dependencies**

```bash
printf '24.17.0\n' > .nvmrc
printf 'store-dir=.cache/pnpm\n' > .npmrc
```

Scaffold in a disposable directory, inspect it, then reproduce only the required files in the repository (never overwrite `docs/`):

```bash
npm_config_cache=$PWD/.cache/npm npx --yes create-electron-vite@latest /tmp/okami-scaffold -- --template react-ts || npx --yes create-quick-start@latest /tmp/okami-scaffold
test -f docs/superpowers/specs/2026-07-17-okami-workbench-unified-desktop-design.md
```

If neither scaffolder is available, author the files directly from the electron-vite documentation (`https://electron-vite.org/guide/`). Install with exact pins (the lockfile is the version authority for the whole plan):

```bash
pnpm add --save-exact react react-dom react-router-dom zod zustand @tanstack/react-query react-markdown remark-gfm lucide-react @heroui/react @heroui/styles tailwindcss better-sqlite3-multiple-ciphers node-pty execa
pnpm add --save-dev --save-exact electron electron-vite electron-builder typescript vite @vitejs/plugin-react @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-jsx-a11y prettier @types/node @types/react @types/react-dom electron-rebuild
```

`package.json` scripts (exact surface):

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "rebuild:native": "electron-rebuild -f -w better-sqlite3-multiple-ciphers,node-pty",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint . --max-warnings 0",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "package": "electron-vite build && electron-builder --mac --config electron-builder.yml",
    "check": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test"
  }
}
```

Append to `.gitignore`: `.cache/`, `dist/`, `dist-electron/`, `out/`, `release/`, `test-results/`, `playwright-report/`.

- [ ] **Step 3: Implement the minimal secure main process, preload, and React root**

```ts
// src/main/index.ts
import { app, BrowserWindow } from "electron";
import path from "node:path";

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  return window;
}

app.whenReady().then(() => {
  createMainWindow();
});
app.on("window-all-closed", () => app.quit());
```

```ts
// src/preload/index.ts
import { contextBridge } from "electron";

// The full typed API arrives in Task 10; expose only a version marker until then.
contextBridge.exposeInMainWorld("okami", { bridgeVersion: 1 });
```

```tsx
// src/renderer/app/App.tsx
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

`src/main/window.test.ts` asserts the security invariants without launching Electron by exporting the `webPreferences` object from a pure helper and checking `contextIsolation === true`, `nodeIntegration === false`, `sandbox === true`.

`src/renderer/styles/global.css` imports Tailwind before HeroUI: `@import "tailwindcss"; @import "@heroui/styles";`

- [ ] **Step 4: Run the scaffold gate**

```bash
pnpm rebuild:native
pnpm test
pnpm build
pnpm check
```

Expected: all exit `0`; Vitest reports the App and window tests passing; electron-vite emits `out/` bundles for main, preload, and renderer; nothing is written outside the repository.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .nvmrc .npmrc package.json pnpm-lock.yaml tsconfig*.json electron.vite.config.ts eslint.config.js vitest.config.ts index.html src
git commit -m "chore: scaffold Okami Workbench electron shell"
```

### Task 2: Define canonical domain and event contracts (single Zod source)

**Files:**
- Create: `src/shared/ids.ts`
- Create: `src/shared/contracts/event.ts`
- Create: `src/shared/contracts/lane.ts`
- Create: `src/shared/contracts/index.ts`
- Create: `tests/fixtures/contracts/canonical-event-v1.json`
- Create: `src/shared/contracts/event.test.ts`

Because the whole app is TypeScript, Zod schemas in `src/shared/contracts` are the **only** contract definition — main, preload, and renderer all import them. There is no dual Rust/TS fixture round-trip anymore; the fixture guards schema evolution instead.

- [ ] **Step 1: Write the failing contract test**

```ts
// src/shared/contracts/event.test.ts
import fixture from "../../../tests/fixtures/contracts/canonical-event-v1.json";
import { describe, expect, it } from "vitest";
import { canonicalEventSchema } from "./event";

describe("canonicalEventSchema", () => {
  it("accepts the frozen v1 fixture", () => {
    const event = canonicalEventSchema.parse(fixture);
    expect(event.schemaVersion).toBe(1);
    expect(event.kind).toBe("tool_call_completed");
  });
  it("rejects an unknown kind", () => {
    expect(() => canonicalEventSchema.parse({ ...fixture, kind: "mystery" })).toThrow();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/shared/contracts/event.test.ts` — Expected: FAIL, `Cannot find module './event'`.

- [ ] **Step 3: Implement ids and the v1 envelope**

```ts
// src/shared/ids.ts
import { randomUUID } from "node:crypto";
export type TaskId = string & { readonly __brand: "TaskId" };
export type LaneId = string & { readonly __brand: "LaneId" };
export type RunId = string & { readonly __brand: "RunId" };
export const newTaskId = () => randomUUID() as TaskId;
export const newLaneId = () => randomUUID() as LaneId;
export const newRunId = () => randomUUID() as RunId;
```

```ts
// src/shared/contracts/event.ts
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
export type CanonicalEventKind = z.infer<typeof canonicalEventKindSchema>;
```

```ts
// src/shared/contracts/lane.ts
import { z } from "zod";
export const runtimeKindSchema = z.enum(["claude", "codex"]);
export const providerKindSchema = z.enum(["claude_max", "chatgpt"]);
export const laneStatusSchema = z.enum(["ready", "running", "waiting_approval", "interrupted", "failed", "closed"]);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;
export type LaneStatus = z.infer<typeof laneStatusSchema>;
```

The fixture `tests/fixtures/contracts/canonical-event-v1.json` is identical to the Tauri plan's fixture (schemaVersion 1, sequence 7, kind `tool_call_completed`, UUID task/lane/run ids, `nativeEventId: "native-tool-7"`).

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm test src/shared/contracts/event.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared tests/fixtures/contracts
git commit -m "feat: define canonical workbench contracts"
```

### Task 3: Open encrypted SQLite state with a safeStorage-owned key

**Files:**
- Create: `src/main/secrets.ts`
- Create: `src/main/db/connection.ts`
- Create: `src/main/db/migrations.ts`
- Create: `src/main/db/schema/001-phase1-core.sql`
- Create: `src/main/db/connection.test.ts`

- [ ] **Step 1: Write failing encryption and migration tests**

```ts
// src/main/db/connection.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./connection";

describe("openDatabase", () => {
  it("encrypts with SQLCipher, migrates to v1, and rejects a wrong key", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "okami-db-"));
    const file = path.join(dir, "workbench.db");
    const key = Buffer.alloc(32, 7);
    const db = openDatabase(file, key);
    expect(db.pragma("cipher_version", { simple: true })).toBeTruthy();
    expect(db.pragma("user_version", { simple: true })).toBe(1);
    db.close();
    expect(() => openDatabase(file, Buffer.alloc(32, 8))).toThrow();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/main/db/connection.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement key management, SQLCipher open, and the full Phase 1 schema**

```ts
// src/main/secrets.ts
import { app, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// The raw key never touches disk: only the safeStorage-encrypted blob is persisted,
// and safeStorage's own key lives in the macOS Keychain.
export function getOrCreateDatabaseKey(): Buffer {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Keychain-backed encryption unavailable");
  const blobPath = path.join(app.getPath("userData"), "db-key.enc");
  if (existsSync(blobPath)) return Buffer.from(safeStorage.decryptString(readFileSync(blobPath)), "base64");
  const key = randomBytes(32);
  writeFileSync(blobPath, safeStorage.encryptString(key.toString("base64")), { mode: 0o600 });
  return key;
}
```

```ts
// src/main/db/connection.ts
import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import { readFileSync } from "node:fs";
import path from "node:path";

export type Database = ReturnType<typeof openDatabase>;

export function openDatabase(file: string, key: Buffer) {
  const db = new SqliteDatabase(file);
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`key="x'${key.toString("hex")}'"`);
  db.pragma("foreign_keys = ON");
  db.prepare("SELECT count(*) FROM sqlite_master").get(); // throws on wrong key
  runMigrations(db);
  return db;
}

function runMigrations(db: InstanceType<typeof SqliteDatabase>) {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version >= 1) return;
  const sql = readFileSync(path.join(import.meta.dirname, "schema/001-phase1-core.sql"), "utf8");
  db.exec(sql);
}
```

`schema/001-phase1-core.sql` reuses the Tauri plan's schema verbatim (it is plain SQLite DDL): tables `tasks`, `conversations`, `messages`, `runtime_lanes`, `native_session_bindings`, `runs`, `events` (UNIQUE `(lane_id, sequence)` + partial unique `(lane_id, native_event_id)`), `event_cursors`, `artifacts`, `approvals`, `capability_leases`, `usage_sources`, `usage_windows`, `usage_snapshots`, `usage_activity_buckets`, `memory_sources`, `memory_documents`, the `memory_fts` FTS5 virtual table with insert/update/delete sync triggers, and `audit_entries` — wrapped in `BEGIN IMMEDIATE; … PRAGMA user_version = 1; COMMIT;`. Copy the DDL block from `docs/superpowers/plans/2026-07-17-okami-workbench-phase-1.md` Task 3 Step 3.

Vitest config runs `src/main/**/*.test.ts` in `node` environment and `src/renderer/**` in `jsdom`; the secrets test for `safeStorage` is covered later in E2E because it needs a real Electron `app` (unit tests inject the key directly).

- [ ] **Step 4: Verify**

```bash
pnpm test src/main/db/connection.test.ts
pnpm lint
```

Expected: PASS; wrong key throws before migrations run.

- [ ] **Step 5: Commit**

```bash
git add src/main/secrets.ts src/main/db vitest.config.ts
git commit -m "feat: add encrypted local persistence"
```

### Task 4: Implement append-only event, task, lane, and run repositories

**Files:**
- Create: `src/main/db/repositories/tasks.ts`
- Create: `src/main/db/repositories/lanes.ts`
- Create: `src/main/db/repositories/runs.ts`
- Create: `src/main/db/repositories/events.ts`
- Create: `src/main/db/repositories/audit.ts`
- Create: `src/main/db/test-support.ts`
- Create: `src/main/db/repositories/events.test.ts`

- [ ] **Step 1: Write the failing repository behavior test**

```ts
// src/main/db/repositories/events.test.ts
import { describe, expect, it } from "vitest";
import { createTestDatabase, sequenceEvent } from "../test-support";

describe("EventRepository", () => {
  it("is append-only, idempotent, and cursor-ordered", () => {
    const fx = createTestDatabase();
    const first = fx.event(sequenceEvent(1, "native-1"));
    expect(fx.events.append(first).inserted).toBe(true);
    expect(fx.events.append(first).inserted).toBe(false);
    fx.events.append(fx.event(sequenceEvent(2, "native-2")));
    const delta = fx.events.afterCursor(first.laneId, 1);
    expect(delta.map((e) => e.sequence)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/main/db/repositories/events.test.ts` — Expected: FAIL, modules missing.

- [ ] **Step 3: Implement transactional repositories**

```ts
// src/main/db/repositories/events.ts
import type { Database } from "../connection";
import { canonicalEventSchema, type CanonicalEvent } from "../../../shared/contracts/event";

export class EventRepository {
  constructor(private readonly db: Database) {}

  append(event: CanonicalEvent): { inserted: boolean } {
    canonicalEventSchema.parse(event);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO events
         (id, task_id, lane_id, run_id, sequence, occurred_at, kind, native_event_id, payload_json)
         VALUES (@id, @taskId, @laneId, @runId, @sequence, @occurredAt, @kind, @nativeEventId, @payload)`,
      )
      .run({ ...event, payload: JSON.stringify(event.payload) });
    return { inserted: result.changes === 1 };
  }

  afterCursor(laneId: string, cursor: number): CanonicalEvent[] {
    return this.db
      .prepare(`SELECT * FROM events WHERE lane_id = ? AND sequence > ? ORDER BY sequence`)
      .all(laneId, cursor)
      .map(rowToEvent);
  }
}
```

Event rows expose no update or delete method. `test-support.ts` opens an in-memory unencrypted database (`new SqliteDatabase(":memory:")` + migrations), seeds one task/lane/run, and returns typed repositories plus an `event(overrides)` helper. Task/lane/run repositories use optimistic `updated_at` checks on update. `audit.ts` exposes `record(entry)` insert-only.

- [ ] **Step 4: Run repository and regression suites**

```bash
pnpm test src/main/db
pnpm lint
```

Expected: PASS; duplicate native events never create duplicates.

- [ ] **Step 5: Commit**

```bash
git add src/main/db
git commit -m "feat: persist tasks lanes runs and events"
```

### Task 5: Enforce capability leases and approval state transitions

**Files:**
- Create: `src/main/policy/action.ts`
- Create: `src/main/policy/lease.ts`
- Create: `src/main/policy/approval.ts`
- Create: `src/main/policy/engine.ts`
- Create: `src/main/policy/engine.test.ts`

- [ ] **Step 1: Write failing least-privilege tests**

```ts
// src/main/policy/engine.test.ts
import { describe, expect, it } from "vitest";
import { createPolicyHarness } from "./test-harness";

describe("PolicyEngine", () => {
  it("denies out-of-scope and expired leases", () => {
    const h = createPolicyHarness();
    const lease = h.lease("workspace.read", "/repo-a", "2026-07-17T19:00:00Z");
    expect(h.authorizeAt(lease, "workspace.read", "/repo-b", "2026-07-17T18:00:00Z")).toEqual({ decision: "deny", reason: "resource_mismatch" });
    expect(h.authorizeAt(lease, "workspace.read", "/repo-a", "2026-07-17T20:00:00Z")).toEqual({ decision: "deny", reason: "expired" });
  });

  it("makes approvals single-use", () => {
    const h = createPolicyHarness();
    const req = h.pendingApproval("terminal.exec", "git status");
    h.resolve(req.id, "allow_once");
    expect(() => h.resolve(req.id, "allow_once")).toThrow(/already resolved/i);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/main/policy` — Expected: FAIL.

- [ ] **Step 3: Implement deterministic authorization (no model calls)**

```ts
// src/main/policy/action.ts
export type Actor = { kind: "human"; id: string } | { kind: "runtime"; runtime: "claude" | "codex" } | { kind: "automation"; id: string };
export type Capability = "workspace.read" | "workspace.write" | "terminal.exec" | "browser.open" | "approval.resolve" | "memory.read" | "audit.export";
export type RiskLevel = "read" | "prepare" | "execute" | "critical";
export type DenyReason =
  | "destructive_outside_workspace" | "missing_lease" | "expired" | "actor_mismatch"
  | "task_mismatch" | "lane_mismatch" | "capability_mismatch" | "resource_mismatch" | "budget_exceeded";
export type AuthorizationDecision =
  | { decision: "allow"; leaseId: string }
  | { decision: "ask"; approvalId: string }
  | { decision: "deny"; reason: DenyReason };
```

`engine.ts` evaluates in fixed order: hard deny for destructive/out-of-workspace actions → lease existence → expiry → actor → task/lane scope → capability → resource glob → budget → risk. `read` and explicitly leased `prepare` may return `allow`; `execute`/`critical` always return `ask` with a created approval. Every decision writes an audit row before returning. `approval.ts` enforces single-use resolution (`pending → allowed_once | denied | expired`, any second transition throws).

- [ ] **Step 4: Run policy plus repository regressions**

```bash
pnpm test src/main/policy src/main/db
pnpm lint
```

Expected: PASS; policy imports no runtime adapter and no LLM client.

- [ ] **Step 5: Commit**

```bash
git add src/main/policy
git commit -m "feat: enforce capability leases and approvals"
```

### Task 6: Build cancellable JSONL process transport and runtime supervisor

**Files:**
- Create: `src/main/runtime/transport.ts`
- Create: `src/main/runtime/adapter.ts`
- Create: `src/main/runtime/supervisor.ts`
- Create: `src/main/runtime/registry.ts`
- Create: `tests/fixtures/runtime/jsonl-echo.mjs`
- Create: `src/main/runtime/transport.test.ts`

- [ ] **Step 1: Write the failing transport lifecycle test**

```ts
// src/main/runtime/transport.test.ts
import { describe, expect, it } from "vitest";
import path from "node:path";
import { JsonlProcess } from "./transport";

const fixture = path.resolve("tests/fixtures/runtime/jsonl-echo.mjs");

describe("JsonlProcess", () => {
  it("streams unicode lines and cancels without orphaning", async () => {
    const proc = await JsonlProcess.spawn(process.execPath, [fixture]);
    await proc.send({ id: 1, text: "ação 狼" });
    const echoed = await proc.next();
    expect(echoed?.text).toBe("ação 狼");
    await proc.cancel();
    const exit = await proc.wait();
    expect(exit.successOrCancelled).toBe(true);
  });
});
```

`jsonl-echo.mjs` reads stdin line by line and echoes each JSON line back to stdout; on SIGTERM it exits 0.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/main/runtime/transport.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement bounded JSONL transport and the adapter contract**

```ts
// src/main/runtime/transport.ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

const MAX_BUFFERED = 256;

export class JsonlProcess {
  private queue: unknown[] = [];
  private waiters: Array<(value: unknown) => void> = [];

  static async spawn(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], cwd: options?.cwd, env: options?.env });
    return new JsonlProcess(child);
  }

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (this.queue.length >= MAX_BUFFERED) this.child.stdout.pause(); // backpressure, resumed on drain in next()
      const value = safeParse(line);
      if (value === undefined) return; // non-JSON noise goes to diagnostics, never to the conversation
      const waiter = this.waiters.shift();
      if (waiter) waiter(value);
      else this.queue.push(value);
    });
  }

  async send(message: unknown) {
    await new Promise<void>((resolve, reject) =>
      this.child.stdin.write(JSON.stringify(message) + "\n", (err) => (err ? reject(err) : resolve())),
    );
  }

  async cancel() {
    this.child.kill("SIGTERM");
    const killTimer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    this.child.once("exit", () => clearTimeout(killTimer));
  }
}
```

`adapter.ts` defines the `RuntimeAdapter` interface (`kind`, `detect`, `start`, `resume`, `sendTurn`, `respondToApproval`, `cancel`, `usageCapabilities`) mirroring the spec's contract. `supervisor.ts` tracks owned child PIDs, restarts policy, and exposes `liveOwnedRunIds()` for recovery. Stderr is a separate redacted diagnostic stream.

- [ ] **Step 4: Verify no orphan processes**

```bash
pnpm test src/main/runtime/transport.test.ts
pgrep -f jsonl-echo.mjs || echo "no orphans"
```

Expected: PASS; `no orphans`.

- [ ] **Step 5: Commit**

```bash
git add src/main/runtime tests/fixtures/runtime/jsonl-echo.mjs
git commit -m "feat: add runtime process supervisor"
```

### Task 7: Integrate Codex app-server with subscription auth and approvals

**Files:**
- Create: `src/main/runtime/codex/client.ts`
- Create: `src/main/runtime/codex/projector.ts`
- Create: `src/main/runtime/codex/adapter.ts`
- Create: `tests/fixtures/runtime/codex/turn.jsonl`
- Create: `tests/fixtures/runtime/codex/approval.jsonl`
- Create: `src/main/runtime/codex/projector.test.ts`
- Create: `src/main/runtime/codex/live.test.ts`
- Modify: `src/main/runtime/registry.ts`

- [ ] **Step 1: Write fixture-first projector tests**

```ts
// src/main/runtime/codex/projector.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CodexProjector } from "./projector";

const lines = readFileSync("tests/fixtures/runtime/codex/approval.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("CodexProjector", () => {
  it("projects tool and approval notifications without loss", () => {
    const projected = new CodexProjector(testIds()).projectAll(lines);
    expect(projected.some((e) => e.kind === "tool_call_started")).toBe(true);
    expect(projected.some((e) => e.kind === "approval_requested")).toBe(true);
    expect(projected.every((e) => e.nativeEventId !== null)).toBe(true);
  });
});
```

- [ ] **Step 2: Record sanitized fixtures and verify failure**

Capture real protocol samples without consuming a turn (initialize + thread/start only), redact ids/paths, and save as the two fixture files. Then: `pnpm test src/main/runtime/codex` — Expected: FAIL, projector missing.

- [ ] **Step 3: Implement JSON-RPC client, lifecycle, projection, and approvals**

```ts
// src/main/runtime/codex/client.ts — JSON-RPC over the JSONL transport
export class CodexClient {
  constructor(private readonly proc: JsonlProcess) {}

  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "okami-workbench", title: "Okami Workbench", version: appVersion() },
      capabilities: { experimentalApi: false },
    });
    await this.notify("initialized", {});
  }

  startThread(cwd: string) { return this.request("thread/start", { cwd }); }
  resumeThread(threadId: string) { return this.request("thread/resume", { threadId }); }
  startTurn(threadId: string, input: string) { return this.request("turn/start", { threadId, input }); }
  interruptTurn(turnId: string) { return this.request("turn/interrupt", { turnId }); }
  readRateLimits() { return this.request("account/rateLimits/read", {}); }
  readUsage() { return this.request("account/usage/read", {}); }
}
```

The adapter spawns `codex app-server`, uses ChatGPT subscription auth from the user's existing login (never an API key), correlates JSON-RPC ids, and projects `thread/*`, `turn/*`, `item/*`, and server-initiated approval requests to canonical events. Unknown items become `tool_call_updated` with `payload.adapterStatus = "unknown_native_event"`. Approval responses go back only after the shared `ApprovalBroker` resolves.

`live.test.ts` is guarded by `OKAMI_RUN_LIVE_CLI_TESTS=1` (`describe.skipIf`), prints `codex --version`, initializes, reads rate limits, and exits **without** calling `turn/start`.

- [ ] **Step 4: Run fixture tests, then the opt-in live handshake**

```bash
pnpm test src/main/runtime/codex/projector.test.ts
OKAMI_RUN_LIVE_CLI_TESTS=1 pnpm test src/main/runtime/codex/live.test.ts
```

Expected: fixtures pass; live prints Codex `0.144.5` and rate-limit data with zero turns consumed.

- [ ] **Step 5: Commit**

```bash
git add src/main/runtime/codex src/main/runtime/registry.ts tests/fixtures/runtime/codex
git commit -m "feat: integrate Codex app server"
```

### Task 8: Integrate Claude Code stream-json and the policy hook bridge

**Files:**
- Create: `src/main/runtime/claude/command.ts`
- Create: `src/main/runtime/claude/projector.ts`
- Create: `src/main/runtime/claude/hook-server.ts`
- Create: `src/main/runtime/claude/adapter.ts`
- Create: `bin/okami-hook.mjs`
- Create: `tests/fixtures/runtime/claude/session.jsonl`
- Create: `tests/fixtures/runtime/claude/tool-hook.json`
- Create: `src/main/runtime/claude/projector.test.ts`
- Create: `src/main/runtime/claude/hook-bridge.test.ts`
- Create: `src/main/runtime/claude/live.test.ts`
- Modify: `src/main/runtime/registry.ts`

- [ ] **Step 1: Write failing projector and hook authorization tests**

```ts
// src/main/runtime/claude/hook-bridge.test.ts
import { describe, expect, it } from "vitest";
import { startHookHarness } from "./test-harness";

describe("okami-hook bridge", () => {
  it("waits for the same policy broker as the UI", async () => {
    const h = await startHookHarness();
    const pending = h.sendHook(fixtureJson("tests/fixtures/runtime/claude/tool-hook.json"));
    const approval = await h.nextApproval();
    await h.allowOnce(approval.id);
    const result = await pending;
    expect(result.hookSpecificOutput.permissionDecision).toBe("allow");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/main/runtime/claude` — Expected: FAIL, modules missing.

- [ ] **Step 3: Implement the version-probed command and hook bridge**

Exact argument contract for Claude Code `2.1.212`:

```ts
// src/main/runtime/claude/command.ts
export function claudeArgs(opts: { settingsPath: string; sessionId?: string; resumeId?: string }) {
  const base = [
    "--print", "--input-format", "stream-json", "--output-format", "stream-json",
    "--include-partial-messages", "--include-hook-events", "--replay-user-messages",
    "--permission-mode", "manual", "--settings", opts.settingsPath,
  ];
  if (opts.resumeId) return [...base, "--resume", opts.resumeId];
  return [...base, "--session-id", opts.sessionId!]; // never pass both
}
```

The adapter records the `system/init.session_id` Claude returns as the authoritative binding. The generated per-session settings file contains only allowlisted workspaces and hooks; `PreToolUse` invokes `bin/okami-hook.mjs` with a random per-session Unix socket path and capability token passed via inherited environment (never argv). `okami-hook.mjs` sends one length-prefixed JSON request over the socket, waits for allow/deny from the main-process `hook-server.ts` (which consults the same `PolicyEngine`/`ApprovalBroker`), prints the documented `hookSpecificOutput.permissionDecision` JSON, and exits. `PostToolUse` reports metadata but cannot grant authority. If the installed Claude version fails the capability probe, mark the adapter `degraded` and refuse write/execute tools; never fall back to `--dangerously-skip-permissions`.

- [ ] **Step 4: Run fixture tests and the explicit one-turn live smoke**

```bash
pnpm test src/main/runtime/claude/projector.test.ts src/main/runtime/claude/hook-bridge.test.ts
OKAMI_RUN_LIVE_CLI_TESTS=1 OKAMI_LIVE_PROMPT='Reply with exactly OKAMI_CLAUDE_SMOKE' pnpm test src/main/runtime/claude/live.test.ts
```

Expected: fixtures pass; live prints `Claude Code 2.1.212` and subscription auth source, then returns `OKAMI_CLAUDE_SMOKE`; no API key appears anywhere.

- [ ] **Step 5: Commit**

```bash
git add src/main/runtime/claude src/main/runtime/registry.ts bin/okami-hook.mjs tests/fixtures/runtime/claude
git commit -m "feat: integrate Claude Code with policy hooks"
```

### Task 9: Orchestrate persistent lanes and deterministic delta synchronization

**Files:**
- Create: `src/main/orchestration/lane-service.ts`
- Create: `src/main/orchestration/delta.ts`
- Create: `src/main/orchestration/run-service.ts`
- Create: `src/main/orchestration/lane-service.test.ts`
- Modify: `src/main/db/repositories/lanes.ts`
- Modify: `src/main/runtime/adapter.ts`

- [ ] **Step 1: Write failing hot/stale/cold lane tests**

```ts
// src/main/orchestration/lane-service.test.ts
import { describe, expect, it } from "vitest";
import { createLaneHarness } from "./test-harness";

describe("LaneService", () => {
  it("resumes a hot lane without bootstrap", async () => {
    const h = createLaneHarness({ runtime: "codex", nativeSession: "thread-123" });
    const opened = await h.openExisting();
    expect(opened.nativeSessionId).toBe("thread-123");
    expect(opened.delta).toBeNull();
    expect(h.fakeRuntime.resumeCalls).toBe(1);
    expect(h.fakeRuntime.startCalls).toBe(0);
  });

  it("sends only events after the cursor to a stale lane", () => {
    const h = createLaneHarness({ cursor: 4, events: [1, 2, 3, 4, 5, 6, 7] });
    const delta = h.buildDelta();
    expect(delta.fromSequenceExclusive).toBe(4);
    expect(delta.events.map((e) => e.sequence)).toEqual([5, 6, 7]);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/main/orchestration` — Expected: FAIL.

- [ ] **Step 3: Implement lane temperatures and canonical delta packages**

```ts
// src/main/orchestration/delta.ts
export type LaneTemperature = "hot" | "stale" | "cold" | "clean";

export interface DeltaPackage {
  schemaVersion: 1;
  taskId: string;
  fromSequenceExclusive: number;
  toSequenceInclusive: number;
  objective: string;
  constraints: string[];
  decisions: string[];
  git: { branch: string; dirtyFiles: string[] } | null;
  artifacts: string[];
  events: Array<{ sequence: number; kind: string; summary: string }>;
}
```

`open` resumes the native session whenever a binding exists. `DeltaBuilder` uses only persisted deterministic projections; it never calls a runtime. A cursor advances only after the target runtime accepts the delta. Switching lanes writes `lane_switched` to audit and never closes the source lane.

- [ ] **Step 4: Run lane plus adapter regressions**

```bash
pnpm test src/main/orchestration src/main/runtime/codex/projector.test.ts src/main/runtime/claude/projector.test.ts
```

Expected: PASS; hot lane sends zero bootstrap bytes.

- [ ] **Step 5: Commit**

```bash
git add src/main/orchestration src/main/db/repositories/lanes.ts src/main/runtime/adapter.ts
git commit -m "feat: orchestrate persistent runtime lanes"
```

### Task 10: Expose the narrow typed IPC facade (preload bridge)

**Files:**
- Create: `src/shared/contracts/ipc.ts`
- Create: `src/main/ipc/handlers.ts`
- Create: `src/main/ipc/app-state.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/lib/ipc/client.ts`
- Create: `src/renderer/lib/ipc/events.ts`
- Create: `src/renderer/lib/ipc/client.test.ts`
- Create: `src/renderer/test/okami-mock.ts`

- [ ] **Step 1: Write the failing typed-client test**

```ts
// src/renderer/lib/ipc/client.test.ts
import { beforeEach, expect, it } from "vitest";
import { installOkamiMock } from "../../test/okami-mock";
import { workbenchClient } from "./client";

beforeEach(() => installOkamiMock({ systemDoctor: { database: "ok", runtimes: [] } }));

it("validates responses before returning them", async () => {
  await expect(workbenchClient.systemDoctor()).resolves.toEqual({ database: "ok", runtimes: [] });
  installOkamiMock({ systemDoctor: { database: 42, runtimes: [] } });
  await expect(workbenchClient.systemDoctor()).rejects.toThrow(/database/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/renderer/lib/ipc/client.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the enumerated bridge, handlers, and validated client**

```ts
// src/shared/contracts/ipc.ts — the complete Phase 1 command surface
export const ipcChannels = [
  "system:doctor", "task:create", "task:list",
  "lane:open", "lane:sendTurn", "run:cancel", "approval:resolve",
  "quickChat:create", "quickChat:send",
  "usage:overview", "usage:refresh", "usage:alertSet",
  "memory:configure", "memory:search", "memory:reindex",
] as const;
export const eventChannel = "workbench:event";
```

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels, eventChannel } from "../shared/contracts/ipc";

const invoke = Object.fromEntries(
  ipcChannels.map((ch) => [ch, (payload: unknown) => ipcRenderer.invoke(ch, payload)]),
);

contextBridge.exposeInMainWorld("okami", {
  bridgeVersion: 1,
  invoke,
  onEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_: unknown, data: unknown) => listener(data);
    ipcRenderer.on(eventChannel, wrapped);
    return () => ipcRenderer.removeListener(eventChannel, wrapped);
  },
});
```

`src/main/ipc/handlers.ts` registers one `ipcMain.handle` per channel, parses the request with the channel's Zod schema **before** touching services, and returns typed results; `event.senderFrame` origin is checked against the app's own renderer. The facade accepts no raw executable path, arbitrary filesystem path, SQL, or provider token from the renderer. `app-state.ts` composes dependencies only. The renderer client parses every response with Zod (`invokeParsed(channel, args, schema)`), and `events.ts` parses `workbench:event` payloads with `canonicalEventSchema` before they reach any store.

- [ ] **Step 4: Run gates**

```bash
pnpm test src/renderer/lib/ipc src/main/ipc
pnpm typecheck
```

Expected: PASS; malformed responses are rejected before state mutation.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts/ipc.ts src/main/ipc src/preload/index.ts src/renderer/lib src/renderer/test
git commit -m "feat: expose typed workbench ipc"
```

### Task 11: Build the accessible Okami desktop shell (five-region layout)

**Files:**
- Create: `src/renderer/app/router.tsx`
- Create: `src/renderer/app/providers.tsx`
- Create: `src/renderer/app/layout/AppShell.tsx`
- Create: `src/renderer/app/layout/NavigationRail.tsx`
- Create: `src/renderer/app/layout/Sidebar.tsx`
- Create: `src/renderer/app/layout/DetailsPanel.tsx`
- Create: `src/renderer/components/ResizablePane.tsx`
- Create: `src/renderer/components/StatusBadge.tsx`
- Create: `src/renderer/app/layout/AppShell.test.tsx`
- Modify: `src/renderer/app/App.tsx`, `src/renderer/styles/tokens.css`, `src/renderer/styles/global.css`

- [ ] **Step 1: Load `frontend-design`, read the layout reference and Okami design system, write the failing navigation test**

```tsx
// src/renderer/app/layout/AppShell.test.tsx
it("navigates with keyboard and exposes the active destination", async () => {
  renderApp("/workbench");
  const usage = screen.getByRole("link", { name: "Uso e limites" });
  usage.focus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByRole("heading", { name: "Uso e limites" })).toBeVisible();
  expect(usage).toHaveAttribute("aria-current", "page");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test src/renderer/app/layout` — Expected: FAIL.

- [ ] **Step 3: Implement the shell with Okami tokens and the five regions**

Okami tokens (from the Tauri plan, unchanged):

```css
/* src/renderer/styles/tokens.css */
:root {
  color-scheme: dark;
  --ok-bg: #08090c; --ok-surface-1: #121318; --ok-surface-2: #181a20; --ok-surface-3: #202229;
  --ok-border: #2a2d35; --ok-text: #f2f2f4; --ok-text-muted: #9a9da6;
  --ok-orange: #ff7a1a; --ok-cyan: #68ddeb; --ok-green: #61cf8c; --ok-yellow: #f2c868; --ok-red: #fb6b75;
  --ok-radius-sm: 6px; --ok-radius-md: 9px;
  --ok-focus: 0 0 0 2px #08090c, 0 0 0 4px #68ddeb;
}
```

`AppShell` renders the five regions as a CSS grid: 64px rail, 240–280px collapsible sidebar, optional 300–340px list pane, flexible focal content, 300–340px collapsible details panel. Routes: `/workbench`, `/quick-chat`, `/usage`, `/memory`, `/connections`. Below 1100px the details panel becomes a drawer; below 760px the text sidebar collapses but the rail remains. Every icon-only control has an accessible name and visible focus ring. The terminal is absent from default navigation (advanced drawer only, Task 13).

- [ ] **Step 4: Run frontend gates**

```bash
pnpm test src/renderer/app/layout
pnpm lint
pnpm typecheck
pnpm build
```

Expected: PASS; zero `jsx-a11y` warnings.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat: build Okami desktop shell"
```

### Task 12: Render tasks, lanes, streaming conversation, and the composer

**Files:**
- Create: `src/renderer/features/workbench/api.ts`
- Create: `src/renderer/features/workbench/store.ts`
- Create: `src/renderer/features/workbench/WorkbenchPage.tsx`
- Create: `src/renderer/features/workbench/TaskListPane.tsx`
- Create: `src/renderer/features/workbench/LaneSelector.tsx`
- Create: `src/renderer/features/workbench/Conversation.tsx`
- Create: `src/renderer/features/workbench/Composer.tsx`
- Create: `src/renderer/features/workbench/WorkbenchPage.test.tsx`
- Modify: `src/renderer/app/router.tsx`

- [ ] **Step 1: Write the failing streaming and lane-switch test**

```tsx
// src/renderer/features/workbench/WorkbenchPage.test.tsx
it("merges deltas once and preserves both lanes when the user switches", async () => {
  const runtime = renderWorkbenchFixture({ lanes: [claudeLane, codexLane] });
  runtime.emit(messageDelta("run-1", "msg-1", "Olá "));
  runtime.emit(messageDelta("run-1", "msg-1", "mundo"));
  runtime.emit(messageDelta("run-1", "msg-1", "mundo")); // duplicate delivery
  expect(await screen.findByText("Olá mundo")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Mudar para Codex" }));
  expect(runtime.calls.laneOpen.at(-1)).toMatchObject({ laneId: codexLane.id });
  expect(runtime.calls.laneClose).toHaveLength(0);
});
```

- [ ] **Step 2: Run and verify failure** — `pnpm test src/renderer/features/workbench` — Expected: FAIL.

- [ ] **Step 3: Implement the store, idempotent reducer, and explicit controls**

```ts
// src/renderer/features/workbench/store.ts
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

The composer shows harness, provider, model, permission mode, and workspace before send. Switching lanes never sends a prompt; it only opens/resumes the selected native session and shows pending delta size. Layout: task list in region 3, conversation in region 4, lane/session details in region 5, per the layout reference.

- [ ] **Step 4: Run gates** — `pnpm test src/renderer/features/workbench && pnpm typecheck && pnpm lint` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/features/workbench src/renderer/app/router.tsx
git commit -m "feat: add task and lane conversation ui"
```

### Task 13: Render native tools, diffs, terminal, browser, HTML, subagents, and approvals

**Files:**
- Create: `src/renderer/features/workbench/events/EventCardRegistry.tsx`
- Create: `src/renderer/features/workbench/events/ToolLifecycleCard.tsx`
- Create: `src/renderer/features/workbench/events/DiffCard.tsx`
- Create: `src/renderer/features/workbench/events/BrowserCard.tsx`
- Create: `src/renderer/features/workbench/events/HtmlPreviewCard.tsx`
- Create: `src/renderer/features/workbench/events/SubagentCard.tsx`
- Create: `src/renderer/features/workbench/events/ApprovalCard.tsx`
- Create: `src/renderer/features/workbench/advanced/TerminalDrawer.tsx`
- Create: `src/renderer/features/workbench/events/EventCards.test.tsx`
- Create: `src/renderer/features/workbench/events/HtmlPreviewCard.test.tsx`
- Modify: `src/renderer/features/workbench/Conversation.tsx`, `package.json`

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

- [ ] **Step 2: Install rendering deps and verify failure**

```bash
pnpm add --save-exact @xterm/xterm @xterm/addon-fit diff2html
pnpm test src/renderer/features/workbench/events
```

Expected: install succeeds; tests FAIL.

- [ ] **Step 3: Implement a closed renderer registry and secure previews**

The registry maps event kinds to card components; unknown events render a collapsed diagnostic card with redacted JSON. `HtmlPreviewCard` uses `<iframe sandbox="" srcDoc={...}>` whose srcDoc begins with `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">`. Browser cards show runtime-provided URL/title/screenshot; opening externally routes through a leased main-process handler (`shell.openExternal` is called only in main after policy allows). Terminal output is read-only xterm; interactive terminal requires a `terminal.exec` lease and shows the workspace path.

- [ ] **Step 4: Run gates** — `pnpm test src/renderer/features/workbench/events && pnpm lint && pnpm typecheck` — Expected: PASS; no test triggers `approval:resolve` before a human click.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/features/workbench
git commit -m "feat: render native workbench tool surfaces"
```

### Task 14: Add workspace-free quick chat with explicit context chips

**Files:**
- Create: `src/main/orchestration/quick-chat.ts`
- Create: `src/main/orchestration/quick-chat.test.ts`
- Create: `src/renderer/features/quick-chat/QuickChatPage.tsx`
- Create: `src/renderer/features/quick-chat/ContextChips.tsx`
- Create: `src/renderer/features/quick-chat/QuickChatPage.test.tsx`
- Modify: `src/main/ipc/handlers.ts`, `src/renderer/app/router.tsx`

- [ ] **Step 1: Write failing no-workspace and context-minimization tests**

```ts
// src/main/orchestration/quick-chat.test.ts
it("has no workspace and sends only selected context", async () => {
  const h = createQuickChatHarness();
  const chat = await h.create("codex");
  expect(chat.workspaceId).toBeNull();
  await h.selectContext(chat.id, ["memory:note-7"]);
  const turn = await h.buildTurn(chat.id, "Resuma isso");
  expect(turn.contextRefs).toEqual(["memory:note-7"]);
  expect(JSON.stringify(turn)).not.toContain("memory:note-8");
});
```

```tsx
// src/renderer/features/quick-chat/QuickChatPage.test.tsx
it("removes a context chip before sending", async () => {
  const runtime = renderQuickChat({ chips: [emailChip, memoryChip] });
  await userEvent.click(screen.getByRole("button", { name: "Remover email atual" }));
  await userEvent.type(screen.getByRole("textbox"), "Resuma");
  await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
  expect(runtime.calls.quickChatSend[0].contextRefs).toEqual([memoryChip.ref]);
});
```

- [ ] **Step 2: Run and verify failure** — `pnpm test quick-chat` — Expected: FAIL.

- [ ] **Step 3: Implement independent conversations and explicit promotion**

Quick chat creates a task row with `kind='quick_chat'`, no workspace, and a selected lane. It never auto-imports histories or project files. `buildTurn` throws if the chat unexpectedly has a workspace. "Promote to task" creates a new normal task, copies only user-selected messages/context refs, and records the source conversation id in audit.

- [ ] **Step 4: Run gates** — `pnpm test quick-chat src/main/orchestration && pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/orchestration src/main/ipc/handlers.ts src/renderer/features/quick-chat src/renderer/app/router.tsx
git commit -m "feat: add workspace free quick chat"
```

### Task 15: Implement Usage Control Center, quick popover, alerts, and preflight

**Files:**
- Create: `src/main/usage/model.ts`
- Create: `src/main/usage/codex-collector.ts`
- Create: `src/main/usage/claude-collector.ts`
- Create: `src/main/usage/activity.ts`
- Create: `src/main/usage/preflight.ts`
- Create: `src/main/usage/collectors.test.ts`
- Create: `tests/fixtures/usage/codex-rate-limits.json`
- Create: `tests/fixtures/usage/claude-usage.txt`
- Create: `src/renderer/features/usage/UsagePage.tsx`
- Create: `src/renderer/features/usage/SubscriptionTable.tsx`
- Create: `src/renderer/features/usage/UsageQuickPopover.tsx`
- Create: `src/renderer/features/usage/UsagePage.test.tsx`
- Modify: `src/main/ipc/handlers.ts`, `src/renderer/features/workbench/LaneSelector.tsx`, `src/renderer/app/router.tsx`

- [ ] **Step 1: Write failing source-integrity and UI-separation tests**

```ts
// src/main/usage/collectors.test.ts
it("never promotes stale presentational data to an official snapshot", () => {
  const parsed = parseClaudeUsage(readFixture("claude-usage.txt"), { cliVersion: "2.1.212" });
  expect(parsed.source.kind).toBe("native_presentational");
  expect(parsed.windows[0].remainingPercent).toBe(83);
  const stale = withFreshness(parsed, { collectedAt: "2026-07-16T10:00:00Z", now: "2026-07-17T10:00:00Z" });
  expect(stale.freshness).toBe("stale");
  expect(stale.source.kind).not.toBe("official_structured");
});
```

```tsx
// src/renderer/features/usage/UsagePage.test.tsx
it("labels quota, session context, and local activity as separate measures", () => {
  renderUsageFixture();
  expect(screen.getByRole("columnheader", { name: "Quota da assinatura" })).toBeVisible();
  expect(screen.getByText("Contexto desta sessão")).toBeVisible();
  expect(screen.getByText("Atividade local")).toBeVisible();
});
```

- [ ] **Step 2: Run and verify failure** — `pnpm test src/main/usage src/renderer/features/usage` — Expected: FAIL.

- [ ] **Step 3: Implement collectors, snapshots, activity buckets, and preflight**

`UsageSourceKind = "official_structured" | "native_presentational" | "dashboard_read" | "local_estimate" | "unavailable"`. Codex uses `account/rateLimits/read` + `account/usage/read` via the existing `CodexClient` → `official_structured`. Claude runs the native `/usage` screen in a short-lived **node-pty** only on user refresh or TTL expiry → `native_presentational`; ANSI is stripped, parsing is versioned per CLI version, and a parser mismatch preserves the previous snapshot as `stale` with an explanatory error. Activity aggregation consumes persisted canonical `usage_reported` events into `usage_activity_buckets` and never writes quota percentages.

`PreflightService.evaluate` filters lanes by capability and health, attaches the latest snapshot per account, returns ranked suggestions with reasons and `automaticSwitch: null` (no auto-switch exists in Phase 1). `lane:sendTurn` blocks only on `hard_stop` policy; low/stale/unavailable quota produces a confirmation warning.

**Activity dashboard (user-requested, spec §10.4):** the Usage page includes a "wrapped"-style activity panel built with Nivo or Recharts (calendar heatmap + stat cards), in two levels driven by a runtime/provider filter: **Geral** (aggregate across all CLIs — total tokens, sessions, messages, active days, current/longest streak, peak hour, favorite model, longest task) and **por CLI/provider** (same stats filtered by runtime or subscription account). All values derive from `usage_activity_buckets` and the local event log — never from quota percentages. Stat cards show tabular numerals; the heatmap uses Okami token colors.

- [ ] **Step 4: Run gates** — `pnpm test src/main/usage src/renderer/features/usage && pnpm typecheck && pnpm lint` — Expected: PASS; test spies confirm refresh spawns only the Codex app-server request or the Claude PTY, never `sendTurn`.

- [ ] **Step 5: Commit**

```bash
git add src/main/usage tests/fixtures/usage src/renderer/features/usage src/main/ipc/handlers.ts src/renderer/features/workbench/LaneSelector.tsx src/renderer/app/router.tsx
git commit -m "feat: add honest usage control center"
```

### Task 16: Index selected Obsidian folders into FTS5 without model calls

**Files:**
- Create: `src/main/memory/config.ts`
- Create: `src/main/memory/scanner.ts`
- Create: `src/main/memory/indexer.ts`
- Create: `src/main/memory/search.ts`
- Create: `src/main/memory/watcher.ts`
- Create: `src/main/memory/indexer.test.ts`
- Create: `tests/fixtures/obsidian/Claude Code/Projetos/okami.md`
- Create: `tests/fixtures/obsidian/Claude Code/Contextos/security.md`
- Create: `src/renderer/features/quick-chat/MemoryPicker.tsx`
- Create: `src/renderer/features/quick-chat/MemoryPicker.test.tsx`
- Modify: `src/main/ipc/handlers.ts`, `src/renderer/features/quick-chat/ContextChips.tsx`

- [ ] **Step 1: Write failing path-scope and provenance tests**

```ts
// src/main/memory/indexer.test.ts
it("indexes only allowed markdown and returns provenance", () => {
  const h = createMemoryHarness("tests/fixtures/obsidian");
  h.allow("Claude Code/Projetos");
  h.fullSync();
  const results = h.search("subscription gateway");
  expect(results).toHaveLength(1);
  expect(results[0].path.endsWith("Claude Code/Projetos/okami.md")).toBe(true);
  expect(results[0].citation).toContain("okami.md");
  expect(h.search("private key fixture")).toHaveLength(0);
});
```

- [ ] **Step 2: Run and verify failure** — `pnpm test src/main/memory` — Expected: FAIL. Install: `pnpm add --save-exact chokidar gray-matter`.

- [ ] **Step 3: Implement scoped scan, redaction, FTS projection, watcher, and picker**

Default suggested vault: `/Users/marcos/Documents/Obsidian/Marcos`; nothing is indexed until a folder is explicitly selected. Access modes: `read`, `read_write`, `read_only_for_models`, `excluded` — Phase 1 implements read and excluded only. Skip hidden folders, `.git`, `.trash`, binaries, files > 2 MiB, and lines matching credential/private-key detectors. Store path, content hash, mtime, title, frontmatter JSON, plain text (via `gray-matter` + markdown stripping), and scope. Search = FTS5/BM25 + deterministic recency; results carry path, heading, line excerpt, score. `chokidar` watcher reindexes changed files only. `MemoryPicker` adds references only on click; a search result alone never enters model context.

- [ ] **Step 4: Run gates** — `pnpm test src/main/memory src/renderer/features/quick-chat && pnpm typecheck` — Expected: PASS; the excluded/security fixture never appears.

- [ ] **Step 5: Commit**

```bash
git add src/main/memory tests/fixtures/obsidian src/renderer/features/quick-chat src/main/ipc/handlers.ts
git commit -m "feat: index selected Obsidian memory"
```

### Task 17: Reconcile interrupted runs, approvals, cursors, and audit after restart

**Files:**
- Create: `src/main/orchestration/recovery.ts`
- Create: `src/main/audit/redaction.ts`
- Create: `src/main/audit/export.ts`
- Create: `src/main/orchestration/recovery.test.ts`
- Create: `src/main/audit/redaction.test.ts`
- Modify: `src/main/db/repositories/runs.ts`, `src/main/runtime/supervisor.ts`, `src/main/index.ts`

- [ ] **Step 1: Write failing crash-recovery and secret-redaction tests**

```ts
// src/main/orchestration/recovery.test.ts
it("marks orphans interrupted without replaying tools", async () => {
  const h = createRecoveryHarness({ runningRunWithCompletedTool: true });
  const report = await h.restart();
  expect(report.interruptedRuns).toBe(1);
  expect(h.toolExecutionCount()).toBe(0);
  expect(h.runStatus()).toBe("interrupted");
  expect(h.resumeCursor()).toBe(9);
});
```

```ts
// src/main/audit/redaction.test.ts
it("redacts credentials and preserves decision metadata", () => {
  const output = exportFixture({ token: "sk-secret", decision: "allow_once" });
  expect(output).not.toContain("sk-secret");
  expect(output).toContain("[REDACTED]");
  expect(output).toContain("allow_once");
});
```

- [ ] **Step 2: Run and verify failure** — `pnpm test recovery redaction` — Expected: FAIL.

- [ ] **Step 3: Implement deterministic startup reconciliation and redaction**

At startup, one transaction moves `starting|running|waiting_approval` runs with no live owned process to `interrupted`, expires orphan pending approvals, preserves the last committed cursor, and emits one `run_interrupted` audit record. It never replays a tool. Native resume failure later offers a cold lane with a visible delta package. Redaction walks JSON recursively, masking keys matching `/token|secret|password|authorization|cookie|private_key/i`, bearer/JWT/API-key string patterns, and configured filesystem paths. Export writes append-only JSONL to a user-selected location through a leased main-process handler.

- [ ] **Step 4: Run gates** — `pnpm test src/main/orchestration src/main/audit src/main/db` — Expected: PASS; two consecutive recoveries produce one interruption audit entry.

- [ ] **Step 5: Commit**

```bash
git add src/main/orchestration src/main/audit src/main/db src/main/runtime/supervisor.ts src/main/index.ts
git commit -m "feat: recover interrupted work safely"
```

### Task 18: Prove the Phase 1 gate visually, end-to-end, and as a macOS bundle

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/launch.ts` (shared `_electron.launch` helper with mock/live modes)
- Create: `tests/e2e/workbench.spec.ts`
- Create: `tests/e2e/usage.spec.ts`
- Create: `tests/e2e/quick-chat.spec.ts`
- Create: `tests/e2e/visual-layout.spec.ts`
- Create: `tests/e2e/security.spec.ts`
- Create: `scripts/doctor.sh`
- Create: `scripts/live-phase1-smoke.sh`
- Create: `scripts/release-gate.sh`
- Create: `electron-builder.yml`
- Create: `docs/qa/phase-1-evidence.md`
- Modify: `package.json`

- [ ] **Step 1: Load `frontend-design`, write failing E2E acceptance tests**

```ts
// tests/e2e/workbench.spec.ts
test("switches Claude to Codex without closing either native lane", async () => {
  const app = await launchWithFixture("two-hot-lanes");
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Mudar para Codex" }).click();
  await expect(page.getByText("Lane Codex retomada")).toBeVisible();
  await expect(page.getByText("0 eventos para sincronizar")).toBeVisible();
  expect(await mainCalls(app, "lane:close")).toHaveLength(0);
});
```

```ts
// tests/e2e/security.spec.ts
test("renderer has no node access and the bridge is frozen", async () => {
  const app = await launchWithFixture("empty");
  const page = await app.firstWindow();
  expect(await page.evaluate(() => typeof (window as any).require)).toBe("undefined");
  expect(await page.evaluate(() => typeof (window as any).process?.versions?.node)).toBe("undefined");
  expect(await page.evaluate(() => Object.keys((window as any).okami).sort())).toEqual(["bridgeVersion", "invoke", "onEvent"]);
});
```

```ts
// tests/e2e/visual-layout.spec.ts
for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 760, height: 900 }]) {
  test(`no overlap at ${size.width}x${size.height}`, async () => {
    const page = await (await launchWithFixture("usage")).firstWindow();
    await page.setViewportSize(size);
    await expectNoHorizontalOverflow(page);
    await expectNoElementOverlap(page, ["main", "nav", "[data-usage-popover]"]);
  });
}
```

- [ ] **Step 2: Install a11y tooling and verify the suite fails**

```bash
pnpm add --save-dev --save-exact @axe-core/playwright
pnpm test:e2e
```

Expected: FAIL — fixtures and scripts missing.

- [ ] **Step 3: Implement fixtures, doctor, live smoke, and release gate**

`launch.ts` boots the built app via `_electron.launch({ args: ["out/main/index.js", "--okami-fixture=<name>"] })`; fixture mode swaps runtime adapters for deterministic fakes inside the main process (no renderer mocking). `scripts/doctor.sh` reports OS/arch, Node/pnpm/Electron versions, SQLCipher availability, installed Claude/Codex versions and subscription-auth status, printing no credential values. `scripts/live-phase1-smoke.sh` requires `OKAMI_RUN_LIVE_CLI_TESTS=1`, creates a temp Git workspace, and drives the fixed sequence:

1. Claude lane creates `claude.txt` with `CLAUDE_LANE_OK`;
2. Codex lane reads it and creates `codex.txt` with `CODEX_SAW_CLAUDE`;
3. Claude resumes its original native session and confirms only the Codex delta;
4. usage refresh shows source/freshness for every value; no hidden run exists;
5. a GPT lane runs one turn through the **Claude harness gateway route**, the lane panel shows `bridged · ChatGPT`, and Claude quota snapshots before/after are identical;
6. restart the app core; both native session bindings and audit entries survive.

`electron-builder.yml` targets `dmg` and `dir` for arm64 with `appId: com.okami.workbench`, `mac.category: public.app-category.developer-tools`, hardened runtime off for the unsigned local candidate (signing/notarization is a separate explicit release step, never committed). `scripts/release-gate.sh` runs `pnpm check`, `pnpm test:e2e`, `./scripts/doctor.sh`, a secret scan over tracked files, `git diff --check`, then `pnpm package`.

- [ ] **Step 4: Run all gates, visual review, live smoke, and bundle**

```bash
pnpm check
pnpm test:e2e
./scripts/doctor.sh
OKAMI_RUN_LIVE_CLI_TESTS=1 ./scripts/live-phase1-smoke.sh
./scripts/release-gate.sh
```

Expected: all suites pass; Axe reports zero serious/critical violations; screenshots at the three viewports show no overlap or clipped controls; live smoke proves Claude → Codex → Claude continuity with exactly three visible user turns and no auxiliary run; `release/` contains `Okami Workbench.app` and a DMG candidate; `docs/qa/phase-1-evidence.md` records commands, versions, timestamps, screenshots, and redacted session-id prefixes.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts electron-builder.yml tests/e2e scripts docs/qa/phase-1-evidence.md
git commit -m "test: prove Okami Workbench phase one"
```

### Task 19: Subscription Gateway — GPT through the Claude harness on ChatGPT quota

> **Execution order:** run this task after Task 9 (it extends the Claude adapter and lane routing) and before Task 12 (the LaneSelector shows routes). It is numbered 19 only to avoid renumbering the plan.

**Files:**
- Create: `src/main/gateway/profile.ts`
- Create: `src/main/gateway/route-resolver.ts`
- Create: `src/main/gateway/server.ts`
- Create: `src/main/gateway/bridges/chatgpt.ts`
- Create: `src/main/gateway/health.ts`
- Create: `src/main/gateway/route-resolver.test.ts`
- Create: `src/main/gateway/bridges/chatgpt.test.ts`
- Create: `src/main/gateway/live.test.ts`
- Create: `tests/fixtures/gateway/anthropic-messages-request.json`
- Create: `tests/fixtures/gateway/chatgpt-stream.jsonl`
- Modify: `src/main/runtime/claude/command.ts`, `src/main/orchestration/lane-service.ts`, `src/main/ipc/handlers.ts`

**What it builds:** a loopback-only HTTP server exposing one Anthropic-compatible endpoint per gateway profile. A profile binds `provider account → bridge or official compatible endpoint`. When a lane selects a non-Claude model, `LaneService` starts the Claude Code CLI with `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/<profileId>` and a per-session bearer token, so the harness, tools, hooks, and approvals are all Claude Code — but inference is billed to the selected provider's subscription. The initial bridge adapts the Anthropic Messages API (including streaming and tool use) to the ChatGPT subscription backend used by Codex, reusing the OAuth tokens from the user's existing `codex login` session state.

- [ ] **Step 1: Write failing route-resolution and quota-isolation tests**

```ts
// src/main/gateway/route-resolver.test.ts
import { describe, expect, it } from "vitest";
import { resolveRoute } from "./route-resolver";

describe("resolveRoute", () => {
  it("routes a GPT lane through the claude harness on the chatgpt profile", () => {
    const route = resolveRoute({ model: "gpt", accounts: accountsFixture() });
    expect(route).toMatchObject({ harness: "claude", kind: "bridged", profile: { provider: "chatgpt" } });
  });

  it("never places anthropic credentials in a non-claude profile", () => {
    const route = resolveRoute({ model: "gpt", accounts: accountsFixture() });
    expect(JSON.stringify(route.profile.env)).not.toMatch(/anthropic|claude/i);
    expect(route.profile.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("falls back to the native runtime explicitly when the bridge is unhealthy", () => {
    const route = resolveRoute({ model: "gpt", accounts: accountsFixture(), health: { chatgpt: "unhealthy" } });
    expect(route).toMatchObject({ harness: "native", kind: "native", runtime: "codex", reason: "bridge_unhealthy" });
  });

  it("routes claude models directly without the gateway", () => {
    const route = resolveRoute({ model: "claude", accounts: accountsFixture() });
    expect(route).toMatchObject({ harness: "claude", kind: "direct" });
  });
});
```

```ts
// src/main/gateway/bridges/chatgpt.test.ts
it("translates an anthropic messages request with tools into a chatgpt turn and back", async () => {
  const bridge = createChatGptBridge(fakeChatGptBackend("tests/fixtures/gateway/chatgpt-stream.jsonl"));
  const request = readJson("tests/fixtures/gateway/anthropic-messages-request.json");
  const events = await collectSse(bridge.handleMessages(request));
  expect(events.some((e) => e.type === "content_block_delta")).toBe(true);
  expect(events.some((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use")).toBe(true);
  expect(events.at(-1)?.type).toBe("message_stop");
});
```

- [ ] **Step 2: Run and verify failure** — `pnpm test src/main/gateway` — Expected: FAIL, modules missing.

- [ ] **Step 3: Implement profiles, server, bridge, health, and lane routing**

```ts
// src/main/gateway/profile.ts
export interface GatewayProfile {
  id: string;
  provider: "chatgpt" | "minimax" | "mimo";
  kind: "bridged" | "compatible";
  // env handed to the Claude Code process for this lane; MUST NOT contain Anthropic credentials.
  env: Record<string, string>;
  displayQuotaAccount: string; // which subscription the lane consumes, shown in the lane panel
}
```

`server.ts` binds `127.0.0.1` only, requires the per-session bearer token, and mounts `/v1/messages` per profile. `bridges/chatgpt.ts` translates Messages API requests (system, messages, tools, streaming SSE) to the ChatGPT backend protocol and back, reading OAuth material from the user's Codex session state read-only; token refresh failures surface as `bridge_unhealthy`, never as a retry against another provider. `health.ts` runs a zero-cost handshake per profile with TTL. `route-resolver.ts` implements the spec §7.1 order: `compatible` → `bridged` → explicit `native` fallback with reason. `lane-service.ts` consumes the route: `harness: "claude"` lanes launch the Claude adapter with the profile env; `harness: "native"` lanes launch the provider's native adapter. The lane details panel and audit record `route.kind` and `displayQuotaAccount` for every run.

`live.test.ts` (guarded by `OKAMI_RUN_LIVE_CLI_TESTS=1`) starts the gateway, runs one real Claude-harness turn on the ChatGPT profile asking for the exact string `OKAMI_GATEWAY_SMOKE`, then reads Codex `account/rateLimits/read` before/after to show ChatGPT consumption, and asserts the Claude usage snapshot is unchanged.

- [ ] **Step 4: Run gates**

```bash
pnpm test src/main/gateway src/main/orchestration
OKAMI_RUN_LIVE_CLI_TESTS=1 pnpm test src/main/gateway/live.test.ts
pnpm typecheck && pnpm lint
```

Expected: unit suites pass with zero network calls; live smoke returns `OKAMI_GATEWAY_SMOKE` billed to ChatGPT with Claude quota intact.

- [ ] **Step 5: Commit**

```bash
git add src/main/gateway src/main/runtime/claude/command.ts src/main/orchestration/lane-service.ts src/main/ipc/handlers.ts tests/fixtures/gateway
git commit -m "feat: route non-claude models through the claude harness gateway"
```

## Phase 1 Spec Coverage Map

| Specification requirement | Implemented and proven by |
|---|---|
| Electron + React + TypeScript, privileged main process, sandboxed renderer | Tasks 1, 3, 10; security E2E in 18 |
| Claude Code and Codex subscription runtimes | Tasks 6–8, 18 |
| Unified Claude harness for non-Claude models with quota isolation (spec §7.1) | Task 19; live proof in Tasks 18–19 |
| Persistent native lanes and delta-only switching | Task 9; live proof in Task 18 |
| Chat-native UI, five-region Okami layout, terminal as advanced drawer | Tasks 11–13 |
| Native browser, HTML, files, diffs, terminal, approvals, subagents | Tasks 7–8 fixtures; renderers and security tests in 13 |
| Global quick chat without workspace | Task 14 |
| Honest usage, activity, alerts, and preflight | Task 15 |
| SQLCipher, FTS5, Keychain-backed key, leases, audit | Tasks 3–5, 17 |
| Basic read-only Obsidian indexing with provenance | Task 16 |
| Restart recovery without duplicate actions | Task 17; native restart proof in 18 |
| Visual, responsive, accessible macOS experience | Tasks 11, 13, 15, 18 |

## Full Phase 1 Definition of Done

- A real task starts in Claude, continues in Codex, and resumes in the original Claude session without a hidden model call.
- A GPT lane runs through the Claude Code harness via the gateway, consumes only ChatGPT quota, and a bridge failure pauses the lane with an explicit native fallback — Claude quota is never touched by a non-Claude model.
- Hot lanes send no bootstrap; stale lanes send only the deterministic event delta.
- Browser/HTML/files/diffs/terminal/subagent/approval events are visible as chat-native components; terminal remains advanced.
- Every privileged action is allowed by a live lease or a single-use approval recorded in audit.
- The renderer is provably sandboxed: no `require`, no Node globals, only the frozen `okami` bridge.
- Quick chats are independent conversations without implicit workspace context.
- Usage UI distinguishes subscription quota, session context, and local activity, with source/freshness on every value; degraded sources become stale/unavailable, never fabricated percentages.
- Selected Obsidian notes are retrieved locally with provenance and enter a prompt only as visible removable chips.
- Restart recovery produces no duplicate event, tool execution, approval, or external action.
- Automated, visual, accessibility, live subscription, and bundle gates have evidence in `docs/qa/phase-1-evidence.md`.

## Implementation References

- [Electron docs](https://www.electronjs.org/docs/latest/)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron process model / utilityProcess](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [electron-vite](https://electron-vite.org/guide/)
- [electron-builder](https://www.electron.build/)
- [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers)
- [Playwright Electron](https://playwright.dev/docs/api/class-electron)
- [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [SQLite FTS5](https://sqlite.org/fts5.html)

## Execution Handoff

Plan execution must use one of these modes:

1. **Codex-Driven (user-selected, recommended):** dispatch each task to Codex through the shared local runtime (`codex:codex-rescue` agent), one task per Codex run, passing the task brief verbatim plus the Global Constraints. Claude Code acts as coordinator only: it reviews each returned diff for specification compliance, runs the task's gate commands itself, and commits. At most two Codex attempts per task; on a second failure the coordinator finishes the task directly. The coordinator never opens a second inference lane to supervise a running Codex task. (Clarification: this describes who writes the app's code during construction — the product itself remains multi-runtime with Claude Code as preferred harness.)
2. **Subagent-Driven:** use `superpowers:subagent-driven-development`; fresh implementation worker per task, review between tasks, at most two attempts before the coordinator takes over.
3. **Inline Execution:** use `superpowers:executing-plans`; execute tasks in small batches with a checkpoint after every sprint.

Do not begin Phase 2 until the complete Phase 1 definition of done passes with real Claude and Codex subscription sessions.
