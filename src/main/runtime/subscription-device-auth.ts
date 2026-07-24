import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ManagedRuntimeCommands } from "./managed-runtime";
import { subscriptionEnvironment } from "./codex/adapter";

export type SubscriptionProvider = "codex" | "grok";

export interface DeviceAuthChallenge {
  provider: SubscriptionProvider;
  verificationUrl: string;
  userCode: string | null;
}

interface DeviceAuthDependencies {
  commands: ManagedRuntimeCommands;
  spawn?: (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv },
  ) => ChildProcessWithoutNullStreams;
  timeoutMs?: number;
}

export class SubscriptionDeviceAuthService {
  private readonly children = new Map<
    SubscriptionProvider,
    ChildProcessWithoutNullStreams
  >();

  constructor(private readonly dependencies: DeviceAuthDependencies) {}

  start(provider: SubscriptionProvider): Promise<DeviceAuthChallenge> {
    this.cancel(provider);
    const command = this.dependencies.commands[provider];
    const child = (this.dependencies.spawn ?? spawn)(
      command,
      ["login", "--device-auth"],
      { env: subscriptionEnvironment() },
    );
    this.children.set(provider, child);
    child.once("exit", () => {
      if (this.children.get(provider) === child) {
        this.children.delete(provider);
      }
    });

    return new Promise((resolve, reject) => {
      let output = "";
      let settled = false;
      const finish = (challenge: DeviceAuthChallenge) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(challenge);
      };
      const inspect = (chunk: Buffer | string) => {
        output = `${output}${String(chunk)}`.slice(-16_384);
        const parsed = parseDeviceAuthChallenge(provider, output);
        if (parsed) finish(parsed);
      };
      child.stdout.on("data", inspect);
      child.stderr.on("data", inspect);
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.children.delete(provider);
        reject(error);
      });
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            sanitizeAuthOutput(output) ||
              `${provider} device login exited with code ${code ?? "unknown"}`,
          ),
        );
      });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.cancel(provider);
        reject(
          new Error(
            `${provider} did not provide a device connection code in time`,
          ),
        );
      }, this.dependencies.timeoutMs ?? 15_000);
    });
  }

  cancel(provider: SubscriptionProvider): void {
    const active = this.children.get(provider);
    if (!active) return;
    this.children.delete(provider);
    active.kill("SIGTERM");
  }

  close(): void {
    this.cancel("codex");
    this.cancel("grok");
  }
}

export function parseDeviceAuthChallenge(
  provider: SubscriptionProvider,
  output: string,
): DeviceAuthChallenge | null {
  const verificationUrl =
    output.match(/https:\/\/[^\s"'<>]+/u)?.[0]?.replace(/[),.;]+$/u, "") ??
    null;
  const userCode =
    output.match(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4,})+\b/iu)?.[0]?.toUpperCase() ??
    output.match(/(?:code|código)\s*[:=]\s*([A-Z0-9-]{6,})/iu)?.[1] ??
    null;
  if (!verificationUrl || !userCode) return null;
  return { provider, verificationUrl, userCode };
}

function sanitizeAuthOutput(output: string): string {
  return output
    .replace(/(?:sk|tp)-[A-Za-z0-9_-]+/gu, "[redacted]")
    .trim()
    .slice(-1_000);
}
