import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { spawn as spawnPty, type IPty } from "node-pty";
import { executableEnvironment } from "./commands";
import { subscriptionEnvironment } from "./codex/adapter";

export type InteractiveAuthProvider = "claude" | "cursor" | "agy" | "opencode";

export interface ProviderAuthCommands {
  claude: string;
  codex: string;
  cursor: string;
  agy: string;
  grok: string;
  opencode: string;
}

export type AuthPty = Pick<
  IPty,
  "pid" | "write" | "resize" | "kill" | "onData" | "onExit"
>;

interface ProviderAuthSessionDependencies {
  commands: ProviderAuthCommands;
  spawn?: (
    command: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ) => AuthPty;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  createId?: () => string;
  onData?: (event: {
    sessionId: string;
    data?: string;
    exited?: boolean;
    exitCode?: number;
  }) => void;
}

/**
 * Runs only allowlisted provider-login programs. The provider executable is
 * spawned directly, never through a shell, so renderer input cannot become a
 * command line.
 */
export class ProviderAuthSessionService {
  private readonly sessions = new Map<string, AuthPty>();

  constructor(private readonly dependencies: ProviderAuthSessionDependencies) {}

  open(
    provider: InteractiveAuthProvider,
    dimensions: { columns: number; rows: number },
  ): { sessionId: string } {
    const resolved = providerAuthCommand(
      provider,
      this.dependencies.commands[provider],
    );
    const environment = executableEnvironment(
      resolved.command,
      subscriptionEnvironment(this.dependencies.environment),
    );
    const pty = (this.dependencies.spawn ?? spawnPty)(
      resolved.command,
      resolved.args,
      {
        name: "xterm-256color",
        cols: dimensions.columns,
        rows: dimensions.rows,
        cwd: this.dependencies.homeDirectory ?? homedir(),
        env: environment,
      },
    );
    const sessionId = (this.dependencies.createId ?? randomUUID)();
    this.sessions.set(sessionId, pty);
    pty.onData((data) =>
      this.dependencies.onData?.({ sessionId, data: scrubAuthOutput(data) }),
    );
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId);
      this.dependencies.onData?.({ sessionId, exited: true, exitCode });
    });
    return { sessionId };
  }

  write(sessionId: string, data: string): void {
    this.requireSession(sessionId).write(data);
  }

  resize(sessionId: string, columns: number, rows: number): void {
    this.requireSession(sessionId).resize(columns, rows);
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.kill("SIGTERM");
  }

  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.close(sessionId);
  }

  private requireSession(sessionId: string): AuthPty {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Provider authentication session is closed.");
    return session;
  }
}

export function providerAuthCommand(
  provider: InteractiveAuthProvider,
  command: string,
): { command: string; args: string[] } {
  switch (provider) {
    case "claude":
      return { command, args: ["auth", "login", "--claudeai"] };
    case "cursor":
      return { command, args: ["login"] };
    case "agy":
      return { command, args: [] };
    case "opencode":
      return { command, args: ["auth", "login"] };
  }
}

function scrubAuthOutput(value: string): string {
  return value
    .replace(/(?:sk|tp)-[A-Za-z0-9_-]+/gu, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [redacted]");
}
