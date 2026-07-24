# Okami Runtime SDK

The Okami Runtime SDK separates a provider identity from the mechanism used to
reach it. This prevents the desktop product from collapsing when a local CLI is
removed and prevents one provider from being silently routed through another.

## Components

1. `ProviderRuntimeAdapter` probes ordered transports and selects the first
   healthy one.
2. Managed, versioned artifacts provide Codex, Grok, Cursor, Antigravity, and
   OpenCode without resolving a binary installed globally.
3. The MiMo Responses transport implements streaming, continuation, exact
   provider usage, cancellation, and function-call continuation using Token
   Plan entitlement.
4. The MiniMax Chat Completions transport implements streaming, usage, conversation
   continuation, and cancellation for MiniMax.
5. Workspace tools are owned by OkamiCode. Reads, searches, writes, and shell
   commands enforce workspace containment and pass mutations through the
   existing policy and approval engine.
6. Canonical events keep the renderer independent from provider wire formats.

## Transport matrix

| Provider | Transport | Executable ownership | Entitlement |
| --- | --- | --- | --- |
| OpenAI / Codex | `codex-managed` | OkamiCode app bundle | ChatGPT subscription OAuth/device |
| xAI / Grok | `grok-managed` | OkamiCode user-data, materialized from the bundle | Grok subscription OAuth/device |
| Cursor | `cursor-agent` | OkamiCode app bundle | official Cursor subscription login |
| Antigravity | `agy-cli` | OkamiCode app bundle | official local subscription login |
| OpenCode | `opencode-acp` | OkamiCode app bundle | OpenCode configuration |
| Xiaomi MiMo | `mimo-token-plan` | none | encrypted `tp-*` key and Token Plan URL |
| MiniMax | `minimax-token-plan` | none | encrypted `sk-cp-*` key |
| Anthropic / Claude | `claude-cli` | external host exception | official Claude subscription login |

The built-in manifest contains no pay-as-you-go transport. Token Plan secrets
are encrypted with Electron `safeStorage`, stored with restrictive file modes,
and never returned through IPC. Invalid key families are rejected before they
can be persisted.

## Session compatibility

New native session ids are transport-bound. Legacy ids remain unmodified and
are routed through the provider's designated legacy transport. This preserves
existing tasks while preventing a session created by one harness from being
sent accidentally to another.

## Security boundary

- Provider secrets are never included in diagnostics or renderer payloads.
- Paths are resolved inside the selected workspace and checked against symlink
  escape.
- Plan mode denies writes and shell execution.
- Mutating tools require the existing capability lease and approval policy.
- Known destructive shell patterns are rejected.
- Automated tests use fixtures and injected fetch implementations; they do not
  consume provider quota.
- The packaged acceptance gate resolves real paths, rejects symlink escape,
  probes only `--version` with `PATH=/usr/bin:/bin` and an isolated `HOME`, and
  reports provider, version, source, expected and observed SHA-256, and
  ownership as JSON. An `afterPack` trust manifest inventories every provider:
  five managed executable payloads have expected hashes, MiMo and MiniMax have
  no executable, and external Claude has no package-owned expected hash.

## Current limitations

- MiniMax tool calling is not yet implemented in the Chat Completions
  transport, so its manifest does not advertise tools.
- Claude still depends on its official host CLI. It is the only executable
  allowed outside OkamiCode-owned locations.
- Subscription quota windows remain provider-specific. Token Plan transports report
  observed token usage but cannot infer a subscription's hidden quota.
