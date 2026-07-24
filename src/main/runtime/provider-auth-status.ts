import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { executableEnvironment } from "./commands";
import { subscriptionEnvironment } from "./codex/adapter";
import type { ProviderAuthCommands } from "./provider-auth-session";

const execFileAsync = promisify(execFile);

export type ProbedAuthProvider =
  "claude" | "codex" | "cursor" | "agy" | "grok" | "opencode";

export interface ProviderAuthProbe {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProviderAuthStatus {
  provider: ProbedAuthProvider | "mimo" | "minimax";
  status: "connected" | "not_connected" | "unavailable" | "unknown";
  accountLabel: string | null;
  detail: string;
  ownership: "okami" | "host";
}

interface ProviderAuthStatusDependencies {
  commands: ProviderAuthCommands;
  execute?: (
    command: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
  ) => Promise<ProviderAuthProbe>;
}

export class ProviderAuthStatusService {
  constructor(private readonly dependencies: ProviderAuthStatusDependencies) {}

  async list(): Promise<ProviderAuthStatus[]> {
    return Promise.all(
      (["claude", "codex", "cursor", "agy", "grok", "opencode"] as const).map(
        (provider) => this.read(provider),
      ),
    );
  }

  private async read(
    provider: ProbedAuthProvider,
  ): Promise<ProviderAuthStatus> {
    const command = this.dependencies.commands[provider];
    try {
      const probe = await (this.dependencies.execute ?? executeProbe)(
        command,
        providerStatusArgs(provider),
        executableEnvironment(
          command,
          subscriptionEnvironment({ NO_OPEN_BROWSER: "1" }),
        ),
      );
      return parseProviderAuthProbe(provider, probe);
    } catch (error) {
      const candidate = error as {
        code?: string | number;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      if (candidate.code === "ENOENT") {
        return status(provider, "unavailable", null, "Motor não encontrado.");
      }
      const parsed = parseProviderAuthProbe(provider, {
        stdout: String(candidate.stdout ?? ""),
        stderr: String(candidate.stderr ?? safeError(error)),
        exitCode: typeof candidate.code === "number" ? candidate.code : 1,
      });
      return parsed;
    }
  }
}

export function parseProviderAuthProbe(
  provider: ProbedAuthProvider,
  probe: ProviderAuthProbe,
): ProviderAuthStatus {
  const output = stripAnsi(`${probe.stdout}\n${probe.stderr}`);
  const email =
    output.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0] ?? null;

  if (provider === "claude") {
    try {
      const value = JSON.parse(probe.stdout) as {
        loggedIn?: boolean;
        email?: unknown;
        subscriptionType?: unknown;
      };
      if (value.loggedIn) {
        return status(
          provider,
          "connected",
          typeof value.email === "string" ? value.email : null,
          typeof value.subscriptionType === "string"
            ? `Assinatura ${value.subscriptionType}`
            : "Assinatura Claude conectada.",
        );
      }
    } catch {
      // Older Claude builds return plain text; shared fallbacks handle it.
    }
  }

  if (
    /\b(logged in|authenticated successfully|connected)\b/iu.test(output) ||
    (provider === "codex" && /\bLogged in using ChatGPT\b/iu.test(output)) ||
    (provider === "agy" &&
      probe.exitCode === 0 &&
      /\bgemini-[\w.-]+\b/iu.test(probe.stdout)) ||
    (provider === "grok" &&
      probe.exitCode === 0 &&
      /\bgrok-[\w.-]+\b/iu.test(probe.stdout))
  ) {
    return status(
      provider,
      "connected",
      email,
      "Conta de assinatura conectada.",
    );
  }

  if (provider === "opencode" && probe.exitCode === 0) {
    const credentialLines = stripAnsi(probe.stdout)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    return credentialLines.length > 0
      ? status(
          provider,
          "connected",
          null,
          `${credentialLines.length} provider(s) configurado(s).`,
        )
      : status(provider, "not_connected", null, "Nenhum provider configurado.");
  }

  if (
    /\b(not logged|not authenticated|sign in|login required|unauthorized)\b/iu.test(
      output,
    ) ||
    probe.exitCode !== 0
  ) {
    return status(provider, "not_connected", null, "Conta não conectada.");
  }

  return status(provider, "unknown", email, "O provider não informou a conta.");
}

function providerStatusArgs(provider: ProbedAuthProvider): string[] {
  switch (provider) {
    case "claude":
      return ["auth", "status"];
    case "codex":
      return ["login", "status"];
    case "cursor":
      return ["status"];
    case "agy":
      return ["models"];
    case "grok":
      return ["models"];
    case "opencode":
      return ["auth", "list"];
  }
}

function status(
  provider: ProbedAuthProvider,
  connection: ProviderAuthStatus["status"],
  accountLabel: string | null,
  detail: string,
): ProviderAuthStatus {
  return {
    provider,
    status: connection,
    accountLabel,
    detail,
    ownership: provider === "claude" ? "host" : "okami",
  };
}

async function executeProbe(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<ProviderAuthProbe> {
  const result = await execFileAsync(command, args, {
    env: environment,
    timeout: 8_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
    exitCode: 0,
  };
}

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  return value.replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, "gu"), "");
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
