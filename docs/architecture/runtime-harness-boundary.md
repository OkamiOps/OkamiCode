# Runtime and harness boundary

OkamiCode owns the desktop experience, task state, lane orchestration, policy,
auditing, bounded handoff, and canonical events. It does not embed another
agentic IDE as its core and it does not silently replace a provider's native
harness with a paid API.

## What we reuse from OpenCode

OpenCode is integrated as a runtime through its official ACP server:

```text
OkamiCode lane -> ACP client -> opencode acp -> configured OpenCode provider
```

The runtime is selectable only after `opencode acp --help` proves ACP support.
OpenCode remains responsible for provider authentication, model selection,
tool loops, and native sessions. OkamiCode translates ACP updates and
permission requests into the same canonical event and approval contracts used
by the other runtimes.

Source: [anomalyco/opencode](https://github.com/anomalyco/opencode).

## What we reuse from BB

BB describes work as persistent threads that can be followed, steered, and
handed from one agent to another. It also reuses provider CLIs that the user has
already authenticated. OkamiCode adopts those product boundaries:

- a task is persistent and provider lanes can be resumed;
- a user can steer a running task explicitly;
- a provider handoff carries bounded task state instead of replaying everything;
- provider authentication remains owned by the provider CLI.

Source: [ymichael/bb](https://github.com/ymichael/bb).

## What we deliberately do not embed

BB is not registered as another OkamiCode runtime. Doing that would put one
multi-agent IDE inside another, duplicate thread/worktree state, and make it
unclear which orchestrator owns approvals and cancellation. We also do not copy
BB telemetry, daemon state, plugins, or HTTP API.

This is a deliberate boundary, not an unfinished adapter:

- OpenCode is a runtime because ACP exposes a focused agent protocol.
- BB is an architectural reference because its public product is a complete
  orchestrator around the same provider CLIs OkamiCode already manages.

## Dependency behavior

Every built-in runtime remains explicit. If its executable disappears,
OkamiCode marks that runtime unavailable and keeps all task and lane data.
Removing a CLI never deletes a project, conversation, worktree, or encrypted
database row. Reinstalling and authenticating the CLI makes the runtime
available again; session resumption still depends on the provider preserving
the referenced native session.
