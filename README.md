# OkamiCode

<p align="center">
  <img src="src/renderer/assets/okami-logo.png" alt="OkamiCode" width="180" />
</p>

<p align="center">
  A local-first desktop cockpit for coding agents, communication, planning, usage intelligence, and durable memory.
</p>

<p align="center">
  <strong>English</strong> · <a href="README.pt-BR.md">Português do Brasil</a>
</p>

> **Beta software.** OkamiCode `1.0.0-beta.1` is usable for local evaluation and active development, but provider parity, quota collection, account connectors, and packaging still depend on the capabilities exposed by each installed CLI and service.

## Why OkamiCode exists

Developers who already pay for several AI subscriptions should not need to keep five terminals and desktop apps open—or pay for a second API bill—just to use the right model for each job.

OkamiCode provides one visual workspace around the CLIs and subscriptions already available on your Mac. A project stays attached to its folder, each provider keeps its own native session, and switching models does not silently ask one paid agent to drive another paid agent.

The product also brings the rest of the workday into the same local cockpit: independent chat, multi-account email, calendars, Kanban tasks, usage and equivalent API-cost analysis, local memory, runtime diagnostics, Git changes, files, terminals, browser previews, and background activity.

## Highlights

### Code workspace

- Folder-bound projects with persistent provider lanes and native session continuity.
- Runtime and model selection directly in the composer.
- Structured rendering for Markdown, tool activity, approvals, errors, timing, and token telemetry.
- Integrated Git change list and diff viewer, file explorer, terminal, browser preview, and background-task surface.
- Explicit permission modes: OkamiCode does not silently grant an agent broader access.

### Independent chat

- Workspace-free conversations for research, writing, translation, and quick questions.
- Separate history so casual chat does not pollute a coding project.
- Optional context and memory attachment.
- Provider, model, effort, execution state, and response provenance remain visible.

### Unified inbox and calendar

- Multiple IMAP/SMTP accounts plus Google OAuth for Gmail.
- HTML email rendering with remote-image controls.
- Read/unread, spam, trash, reply, forward, aliases, bulk actions, AI analysis, draft review, and email-to-task workflows.
- Day, week, and month calendar views with local and linked sources.
- Event details extract meeting links, participants, timezone, location, and notes into scannable sections.

### Tasks and delegation

- Kanban workflow for manual and agent-owned tasks.
- A task stores its objective, instructions, source context, workspace, provider, model, and activation policy.
- Delegated email tasks remain attached to the source conversation and wake the assigned lane only when relevant state changes.

### Usage and subscription intelligence

- Native quota windows when a provider exposes reliable quota data.
- Input, cached-input, output, reasoning, and model-call activity recorded by provider and model when available.
- Equivalent API-cost estimates using OpenRouter price metadata and an explicit model mapping.
- Subscription-versus-API comparison with source, freshness, and coverage indicators.

> Cost values are estimates, not invoices. A missing native token counter remains unavailable; OkamiCode never fabricates zero usage.

### Local memory

- Encrypted local SQLite database with FTS5 full-text search.
- Explicit, read-only indexing of selected Markdown/Obsidian folders.
- File watching, provenance, bounded context injection, and sensitive-line redaction.
- Local GBrain installation/status detection. OkamiCode does not upload the indexed vault to a hosted memory service.

## Supported runtimes

| Runtime             | Adapter                  | Typical account source    | Notes                                                                                   |
| ------------------- | ------------------------ | ------------------------- | --------------------------------------------------------------------------------------- |
| Claude Code         | Native                   | Anthropic subscription    | Sessions, hooks, tools, approvals, usage, and model discovery where exposed             |
| Codex               | Native app-server        | OpenAI subscription       | Sessions, models, effort, approvals, tools, usage, and background work                  |
| Cursor Agent        | Native                   | Cursor subscription       | Model catalog and structured session stream depend on the installed CLI                 |
| Antigravity (`agy`) | Native + local companion | Google AI subscription    | Hook companion is installed locally; capability and quota support are version-dependent |
| Grok CLI            | Native                   | xAI subscription          | Native sessions and structured output where supported by the CLI                        |
| MiMo Code           | Native                   | Xiaomi MiMo token plan    | Execution and model discovery are supported; quota may remain web-console-only          |
| MiniMax (`mmx`)     | Native                   | MiniMax token plan        | Text execution, model discovery, and native usage windows where exposed                 |
| OpenCode            | ACP                      | OpenCode-selected account | Sessions, tools, approvals, and models after `opencode acp` is verified                 |

OkamiCode does not ship or authenticate these CLIs for you. Install each provider CLI separately, sign in through its official flow, and use **Settings** to verify the exact binary, version, and capabilities detected on the machine.

OpenCode is integrated through its official ACP server. BB is an architectural
reference for persistent, steerable threads and explicit handoff; it is not
embedded as a second orchestrator. See
[Runtime and harness boundary](docs/architecture/runtime-harness-boundary.md).

## Architecture

```mermaid
flowchart LR
  UI["React renderer\nvisual work surfaces"] -->|"typed IPC + Zod"| PRELOAD["isolated preload"]
  PRELOAD --> MAIN["Electron main process"]
  MAIN --> POLICY["policy engine\napprovals + leases + audit"]
  MAIN --> DATA["encrypted SQLite\nFTS5 + local repositories"]
  MAIN --> ORCH["lane orchestration\nsessions + event projection"]
  ORCH --> CLAUDE["Claude Code"]
  ORCH --> CODEX["Codex"]
  ORCH --> CURSOR["Cursor Agent"]
  ORCH --> AGY["Antigravity"]
  ORCH --> GROK["Grok CLI"]
  ORCH --> MIMO["MiMo Code"]
  ORCH --> MINIMAX["MiniMax mmx"]
  ORCH --> OPENCODE["OpenCode ACP"]
  MAIN --> CONNECTORS["IMAP/SMTP · Google OAuth\ncalendar · local memory"]
```

Provider output is normalized into canonical events for presentation and persistence. The model still runs through its own CLI and native harness; the UI does not replace those runtimes with a generic OpenRouter execution layer.

## Security and privacy model

- Local-first storage. Conversations, indexes, usage activity, and connector state live on the Mac.
- SQLite is encrypted with a key protected through Electron `safeStorage`.
- Renderer code has no direct Node.js access; privileged actions pass through validated IPC contracts.
- Capability leases, approval records, audit events, expiry, and resource matching gate agent actions.
- Connector secrets are stored outside the repository in the application user-data directory.
- Email HTML is sanitized; remote images are controlled separately.
- Memory indexing only reads explicitly selected roots and rejects path/symlink escape.
- Runtime diagnostics redact bearer tokens and credential-shaped values.

No security boundary is magic: an authenticated local agent can still modify files that you explicitly allow it to access. Review permissions and diffs before approving sensitive work.

## Requirements

- macOS on Apple Silicon for the packaged beta.
- Node.js `24.17.0` (see `.nvmrc`).
- pnpm `11.5.2` through Corepack.
- Xcode Command Line Tools for native Node modules.
- At least one supported, separately installed and authenticated AI CLI.

## Run from source

```bash
git clone https://github.com/OkamiOps/OkamiCode.git
cd OkamiCode
nvm use
corepack enable
pnpm install
pnpm rebuild:native
pnpm dev
```

The database and credentials are created under Electron's macOS application data directory. For isolated development or tests, set `OKAMI_USER_DATA_DIR` to a dedicated local path.

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:e2e
pnpm check
```

`pnpm check` is the required repository gate. Packaging rebuilds native modules for Electron; if tests later report a `better-sqlite3-multiple-ciphers` ABI mismatch, rebuild that dependency for the active Node runtime before re-running the gate:

```bash
pnpm rebuild better-sqlite3-multiple-ciphers
pnpm check
```

## Package the macOS app

```bash
pnpm package
```

The command produces both the unpacked application and the Apple Silicon installer:

- `release/mac-arm64/OkamiCode.app`
- `release/OkamiCode-v1.0.0-beta.1-macOS-arm64.dmg`

Open the DMG, drag **OkamiCode** to **Applications**, and launch it from Applications. The `1.0.0-beta.1` artifact is unsigned and non-notarized, so macOS may require an explicit approval in **Privacy & Security**. Production signing and notarization are intentionally not claimed by this beta.

## Configuration notes

- **Google:** create a Google OAuth Desktop client and authorize Gmail/Calendar with Google's browser flow. OkamiCode does not ask for your normal Google password.
- **IMAP/SMTP:** authentication requirements are controlled by the email provider. Prefer OAuth or provider-specific app credentials when required.
- **OpenRouter:** used as pricing metadata for the equivalent-cost simulation, not as the default inference provider.
- **Memory:** select the exact Obsidian or Markdown folders to index; no folder is imported automatically.
- **Updates:** runtime capabilities are detected from the installed CLI version. Re-scan after upgrading a CLI.

## Beta limitations

- macOS Apple Silicon is the only packaged target in this release.
- Provider capabilities are not identical. Missing structured output, quota, token, or model data is shown as unavailable.
- OAuth credentials and calendar/email behavior still depend on provider configuration and account policy.
- MiMo quota is not exposed by the current CLI and may only be visible in the official web console.
- Equivalent API pricing can drift until the next OpenRouter metadata refresh.
- The beta is not signed or notarized and has not yet gone through a third-party security audit.

## Documentation

- [Changelog](CHANGELOG.md) · [PT-BR](CHANGELOG.pt-BR.md)
- [1.0 Beta release notes](docs/releases/v1.0.0-beta.1.md) · [PT-BR](docs/releases/v1.0.0-beta.1.pt-BR.md)
- [Product principles](PRODUCT.md)

## Project status

OkamiCode is under active development by OkamiOps. Issues should include the OkamiCode version, macOS version, provider/CLI version, the affected surface, and sanitized logs. Never post tokens, OAuth files, mailbox passwords, or private message content in a public issue.
