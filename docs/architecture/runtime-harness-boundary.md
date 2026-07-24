# Runtime and harness boundary

OkamiCode owns provider routing, task state, context, tool execution, policy,
approvals, auditing, usage normalization, cancellation, and canonical events.
A provider is no longer synonymous with an executable installed on the host.

Each provider-facing runtime selects an ordered transport:

```text
OkamiCode lane
  -> ProviderRuntimeAdapter
     -> bundled official subscription runtime
     -> Okami Token Plan transport
     -> official CLI or ACP compatibility transport
  -> canonical events, policy, persistence, and UI
```

The selected transport is bound to the native session identifier. Existing
unprefixed sessions continue through their legacy transport; new sessions use
an `okami:v1:<transport>:<session>` binding so a later configuration change
cannot silently resume a conversation through a different harness.

## Subscription and Token Plan transports

Codex and Grok use official, version-pinned binaries distributed with
OkamiCode. Authentication stays provider-owned and uses the provider's
subscription OAuth/device session. A global `codex` or `grok` executable is not
required.

MiMo and MiniMax use Okami-owned HTTP transports, but only with their dedicated
Token Plan credentials. The encrypted vault rejects ordinary pay-as-you-go key
families. No provider silently falls back to metered API billing.

Model streaming, session continuation, token telemetry, tool calls where
supported, workspace containment, approvals, and cancellation are normalized
by Okami.

## Optional compatibility transports

- Claude Code remains an official CLI transport because the subscription login
  is not exposed as a public third-party OAuth integration.
- Cursor Agent remains an official CLI transport so Cursor subscribers can use
  their account without making Cursor a mandatory dependency for everyone.
- Antigravity and OpenCode ACP remain optional transports while no equivalent
  first-party Okami API integration is configured.
- MiMo and MiniMax local adapters remain optional compatibility fallbacks.

Removing an optional executable never deletes a project, task, conversation,
worktree, database row, or session reference. A runtime is unavailable only
when none of its configured transports can authenticate and pass health checks.

## OpenCode and BB

OpenCode remains available through its official ACP server as one selectable
transport. BB is an architectural reference for persistent, steerable threads
and bounded handoff. It is not embedded as a second orchestrator.

Sources: [anomalyco/opencode](https://github.com/anomalyco/opencode) and
[ymichael/bb](https://github.com/ymichael/bb).

See the detailed [Okami Runtime SDK](okami-runtime-sdk.md) design.
