# Runtime and harness boundary

OkamiCode owns provider routing, task state, context, tool execution, policy,
approvals, auditing, usage normalization, cancellation, and canonical events.
A provider is no longer synonymous with an executable installed on the host.

Each provider-facing runtime selects an ordered transport:

```text
OkamiCode lane
  -> ProviderRuntimeAdapter
     -> Okami-managed packaged subscription runtime
     -> Okami Token Plan transport
     -> external Claude compatibility transport
  -> canonical events, policy, persistence, and UI
```

The selected transport is bound to the native session identifier. Existing
unprefixed sessions continue through their legacy transport; new sessions use
an `okami:v1:<transport>:<session>` binding so a later configuration change
cannot silently resume a conversation through a different harness.

## Subscription and Token Plan transports

Codex, Grok, Cursor Agent, Antigravity, and OpenCode use version-pinned
artifacts distributed with OkamiCode. Their resolved commands are absolute and
must remain inside the application bundle or OkamiCode user-data directory.
Authentication and provider configuration stay provider-owned, but global
executables are neither required nor accepted.

MiMo and MiniMax use Okami-owned HTTP transports, but only with their dedicated
Token Plan credentials. The encrypted vault rejects ordinary pay-as-you-go key
families. No provider silently falls back to metered API billing.

Model streaming, session continuation, token telemetry, tool calls where
supported, workspace containment, approvals, and cancellation are normalized
by Okami.

## Executable ownership

- Codex, Cursor Agent, Antigravity, and OpenCode execute directly from the
  packaged application.
- Grok is materialized atomically from its packaged compressed artifact into
  OkamiCode user-data and executes only from there.
- MiMo and MiniMax have no executable candidate. Their Okami-owned Token Plan
  HTTP transports own both new and migrated legacy sessions.
- Claude Code remains the sole external CLI exception because its subscription
  login is not exposed as a public third-party OAuth integration.

The `afterPack` hook creates an exact trust manifest from the packaged
artifacts. Transport and entitlement values come from the shipped runtime
manifests and are cross-checked against the resolved executable inventory. The
package acceptance gate requires that manifest, runs with a minimal clean
`PATH`, compares expected and observed SHA-256 before probing only executable
versions, and emits machine-readable provider, version, absolute source,
checksum, and ownership evidence. Missing Claude is reported as the optional
external/unavailable exception without a probe; `--claude` enables the
explicit host probe. Default verifier user-data is temporary and removed in
`finally`. A missing, extra, modified, global, or symlink-escaped non-Claude
artifact fails the gate. No acceptance probe sends a provider turn.

## OpenCode and BB

OpenCode remains available through its official ACP server as one selectable
transport. BB is an architectural reference for persistent, steerable threads
and bounded handoff. It is not embedded as a second orchestrator.

Sources: [anomalyco/opencode](https://github.com/anomalyco/opencode) and
[ymichael/bb](https://github.com/ymichael/bb).

See the detailed [Okami Runtime SDK](okami-runtime-sdk.md) design.
