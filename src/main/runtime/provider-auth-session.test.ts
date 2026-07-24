import { describe, expect, it, vi } from "vitest";
import {
  ProviderAuthSessionService,
  providerAuthCommand,
  type AuthPty,
} from "./provider-auth-session";

function fakePty(): AuthPty {
  return {
    pid: 42,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

describe("providerAuthCommand", () => {
  it("uses only subscription-backed login commands", () => {
    expect(providerAuthCommand("claude", "/managed/claude")).toEqual({
      command: "/managed/claude",
      args: ["auth", "login", "--claudeai"],
    });
    expect(providerAuthCommand("cursor", "/managed/cursor-agent")).toEqual({
      command: "/managed/cursor-agent",
      args: ["login"],
    });
    expect(providerAuthCommand("agy", "/managed/agy")).toEqual({
      command: "/managed/agy",
      args: [],
    });
    expect(providerAuthCommand("opencode", "/managed/opencode")).toEqual({
      command: "/managed/opencode",
      args: ["auth", "login"],
    });
  });
});

it("opens an isolated interactive auth session and never invokes a shell", () => {
  const pty = fakePty();
  const spawn = vi.fn(() => pty);
  const service = new ProviderAuthSessionService({
    commands: {
      claude: "/host/claude",
      codex: "/managed/codex",
      cursor: "/managed/cursor-agent",
      agy: "/managed/agy",
      grok: "/managed/grok",
      opencode: "/managed/opencode",
    },
    spawn,
    homeDirectory: "/Users/test",
    environment: { PATH: "/usr/bin" },
    createId: () => "auth-session-1",
  });

  expect(service.open("cursor", { columns: 90, rows: 24 })).toEqual({
    sessionId: "auth-session-1",
  });
  expect(spawn).toHaveBeenCalledWith(
    "/managed/cursor-agent",
    ["login"],
    expect.objectContaining({
      cwd: "/Users/test",
      cols: 90,
      rows: 24,
    }),
  );
});
