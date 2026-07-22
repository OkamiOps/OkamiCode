# Changelog

All notable changes to OkamiCode are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with prerelease identifiers.

Portuguese version: [CHANGELOG.pt-BR.md](CHANGELOG.pt-BR.md)

## [1.0.0-beta.1] - 2026-07-23

### Added

- Local-first Electron desktop shell with Home, Code, independent Chat, Inbox, Calendar, Kanban, Usage, Memory, Agents, Models, Connections, Management, and Settings surfaces.
- Native runtime adapters for Claude Code, Codex, Cursor Agent, Antigravity, Grok CLI, MiMo Code, and MiniMax `mmx`.
- Persistent workspace lanes, native session bindings, provider/model/effort selection, approvals, cancellation, and canonical event projection.
- Integrated Git worktree status and diff inspection, file viewer, terminal, browser preview, and background-task panels.
- Multi-account IMAP/SMTP inbox and Google OAuth support, HTML email rendering, aliases, remote-image control, bulk actions, reply/forward flows, AI analysis, draft review, and email-to-task delegation.
- Calendar day/week/month views with local and linked sources, structured event details, meeting-link extraction, participants, timezones, and locations.
- Actionable Kanban board with manual or delegated ownership, source context, directives, workspace assignment, and change-aware agent activation.
- Native quota collection and per-model activity accounting where providers expose reliable data.
- OpenRouter-backed equivalent API-cost simulation with explicit provider/model mapping, input/cache/output breakdowns, coverage, and freshness.
- Encrypted SQLite persistence, FTS5 memory search, explicit Obsidian/Markdown indexing, file watching, provenance, redaction, and GBrain detection.
- Model favorites, provider catalogs, CLI capability detection, upgrade actions, and runtime diagnostics.
- Portuguese product interface and bilingual public documentation.

### Security

- Added validated IPC contracts and isolated renderer privileges.
- Added capability leases, approval expiry, resource matching, audit persistence, and export.
- Added local secret protection through Electron `safeStorage` and encrypted SQLite.
- Added credential-shaped diagnostic redaction, HTML sanitization, path-bound memory indexing, and symlink-escape protection.

### Known beta limitations

- Packaged artifact targets unsigned, non-notarized macOS Apple Silicon only.
- Runtime parity depends on the installed provider CLI and authenticated subscription.
- Missing model, token, quota, or pricing telemetry remains explicitly unavailable.
- MiMo native quota is currently not exposed by its CLI.
- Connector behavior depends on each email/calendar provider's OAuth and account policies.

[1.0.0-beta.1]: https://github.com/OkamiOps/OkamiCode/releases/tag/v1.0.0-beta.1
