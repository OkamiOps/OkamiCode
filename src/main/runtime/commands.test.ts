import { expect, it, vi } from "vitest";
import { resolveRuntimeCommands } from "./commands";

it("resolves absolute launch commands for every CLI-backed runtime", () => {
  const locate = vi.fn((client: string) => `/resolved/${client}`);
  const managed = {
    codex: "/managed/codex",
    grok: "/managed/grok",
    cursor: "/managed/cursor-agent",
    agy: "/managed/agy",
    opencode: "/managed/opencode",
  };
  const commands = resolveRuntimeCommands(locate, managed);

  expect(commands).toMatchObject({
    claude: "/resolved/claude",
    cursor: "/managed/cursor-agent",
  });
  expect(commands).not.toHaveProperty("mimo");
  expect(commands).not.toHaveProperty("minimax");
  expect(locate).toHaveBeenCalledOnce();
  expect(locate).toHaveBeenCalledWith("claude");
});

it("never consults the locator for an Okami-managed runtime", () => {
  const managedClients = new Set([
    "codex",
    "grok",
    "cursor",
    "agy",
    "opencode",
  ]);
  const locate = vi.fn((client: string) => {
    if (managedClients.has(client)) {
      throw new Error(`Global lookup forbidden for ${client}`);
    }
    return `/global/${client}`;
  });

  expect(
    resolveRuntimeCommands(locate, {
      codex: "/app/runtimes/codex",
      grok: "/app/runtimes/grok",
      cursor: "/app/runtimes/cursor-agent",
      agy: "/app/runtimes/agy",
      opencode: "/app/runtimes/opencode",
    }),
  ).toMatchObject({
    codex: "/app/runtimes/codex",
    grok: "/app/runtimes/grok",
    cursor: "/app/runtimes/cursor-agent",
    agy: "/app/runtimes/agy",
    opencode: "/app/runtimes/opencode",
    claude: "/global/claude",
  });
});

it("keeps every non-Claude runtime independent from the host locator", () => {
  const locate = vi.fn(() => null);
  const commands = resolveRuntimeCommands(locate, {
    codex: "/app/runtimes/codex",
    grok: "/app/runtimes/grok",
    cursor: "/app/runtimes/cursor-agent",
    agy: "/app/runtimes/agy",
    opencode: "/app/runtimes/opencode",
  });

  expect(commands).toEqual({
    claude: "claude",
    codex: "/app/runtimes/codex",
    grok: "/app/runtimes/grok",
    cursor: "/app/runtimes/cursor-agent",
    agy: "/app/runtimes/agy",
    opencode: "/app/runtimes/opencode",
  });
  expect(locate).toHaveBeenCalledOnce();
  expect(locate).toHaveBeenCalledWith("claude");
});
