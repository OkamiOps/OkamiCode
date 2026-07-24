# Product

## Register

product

## Users

Okami Workbench is built first for Marcos and other developers, DevSecOps practitioners, and AI engineers who work across local repositories, several AI subscriptions, email accounts, messaging, tasks, and calendars.

## Product Purpose

Provide a local-first desktop cockpit that unifies coding runtimes, communications, calendar, Kanban, and memory without forcing the user to change tools or resend project context. Human work and delegated agent work must remain explicit and independently controllable.

## Brand Personality

Premium, precise, calm, and elegant. Operational enough for long technical sessions, but conversational rather than terminal-like. The interface should feel native to a focused macOS desktop workflow.

## Anti-references

- Terminal-looking application chrome or raw command output as the primary interface.
- Cramped, illegible forms and tiny low-contrast labels.
- Generic AI dashboards made from decorative cards.
- Bright theme islands inside the dark application.
- Fake quota, event, message, or progress data.
- Automatic agent action without an explicit user delegation or configured trigger.

## Design Principles

- Readability before density: useful information may be dense, controls may not be cramped.
- Use the existing Okami dark tokens, native desktop affordances, HeroUI primitives, and Lucide icons consistently.
- Reveal operational detail progressively and keep the primary task obvious.
- Preserve explicit control over providers, workspaces, agents, approvals, and outbound communication.
- Represent unavailable or stale data honestly, with an actionable recovery path.
- Prefer local-first storage and explicit user-selected transports. API spend,
  subscription-backed CLIs, and fallbacks must remain visible; never create
  hidden provider spend.
- Built-in inference must never fall back to pay-as-you-go billing. Codex and
  Grok use subscription OAuth/device sessions; MiMo and MiniMax accept only
  dedicated Token Plan credentials.

## Accessibility & Inclusion

- Meet WCAG AA contrast for text and interactive states.
- Support keyboard navigation, visible focus, meaningful labels, Escape to close dialogs, and reduced motion.
- Never use color as the only indication of state.
- Keep the interface usable at 1024px and polished at 1440px and above.
- Use readable body, label, helper, and placeholder sizes during long work sessions.
