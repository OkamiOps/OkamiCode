# Okami Runtime SDK

The Okami Runtime SDK separates a provider identity from the mechanism used to
reach it. This prevents the desktop product from collapsing when a local CLI is
removed and prevents one provider from being silently routed through another.

## Components

1. `ProviderRuntimeAdapter` probes ordered transports and selects the first
   healthy one.
2. Managed official runtimes provide Codex app-server and Grok without relying
   on a binary installed globally.
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

| Provider | Transport | Entitlement |
| --- | --- | --- | --- |
| OpenAI / Codex | `codex-managed` | ChatGPT subscription OAuth/device |
| xAI / Grok | `grok-managed` | Grok subscription OAuth/device |
| Xiaomi MiMo | `mimo-token-plan` | encrypted `tp-*` key and Token Plan URL |
| MiniMax | `minimax-token-plan` | encrypted `sk-cp-*` key |
| Anthropic / Claude | `claude-cli` | official Claude subscription login |
| Cursor | `cursor-agent` | official Cursor subscription login |
| Antigravity | `agy-cli` | official local subscription login |
| OpenCode | `opencode-acp` | OpenCode configuration |

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

## Current limitations

- MiniMax tool calling is not yet implemented in the Chat Completions
  transport, so its manifest does not advertise tools.
- Claude, Cursor, Antigravity, and OpenCode still depend on their official local
  transports.
- Subscription quota windows remain provider-specific. Token Plan transports report
  observed token usage but cannot infer a subscription's hidden quota.
