import { expect, it, vi } from "vitest";
import { resolveRuntimeCommands } from "./commands";

it("resolves absolute launch commands for every CLI-backed runtime", () => {
  const locate = vi.fn((client: string) => `/resolved/${client}`);

  expect(resolveRuntimeCommands(locate)).toMatchObject({
    claude: "/resolved/claude",
    cursor: "/resolved/cursor",
    minimax: "/resolved/minimax",
  });
});

it("prefers Okami-managed Codex and Grok runtimes over globally installed CLIs", () => {
  const locate = vi.fn((client: string) => `/global/${client}`);

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
  expect(locate.mock.calls.flat()).not.toEqual(
    expect.arrayContaining(["codex", "grok", "cursor", "agy", "opencode"]),
  );
});
