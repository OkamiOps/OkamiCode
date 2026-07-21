import { constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { subscriptionEnvironment } from "./adapter";

export const AGY_COMPANION_PLUGIN_NAME = "okami-agy-companion";

const HOOK_TIMEOUT_SECONDS = 30;
type AgyHookName = "PreInvocation" | "PreToolUse" | "PostToolUse" | "Stop";

export interface AgyPluginExecutorResult {
  stdout?: string;
}

export type AgyPluginExecutor = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<AgyPluginExecutorResult>;

export interface AgyPluginManagerOptions {
  command: string;
  sourceDirectory: string;
  hookScriptPath: string;
  execute: AgyPluginExecutor;
  env?: NodeJS.ProcessEnv;
}

export type AgyPluginStatus = "absent" | "enabled" | "disabled";

interface AgyPluginManifest {
  name: typeof AGY_COMPANION_PLUGIN_NAME;
}

interface AgyPluginHooks {
  [AGY_COMPANION_PLUGIN_NAME]: {
    PreInvocation: [AgyCommandHook];
    PreToolUse: [AgyToolHookRegistration];
    PostToolUse: [AgyToolHookRegistration];
    Stop: [AgyCommandHook];
  };
}

interface AgyCommandHook {
  type: "command";
  command: string;
  timeout: typeof HOOK_TIMEOUT_SECONDS;
}

interface AgyToolHookRegistration {
  matcher?: "*";
  hooks: [AgyCommandHook];
}

/**
 * Explicit, local companion plugin lifecycle. Construction and status are
 * read-only with respect to AGY's plugin state.
 */
export class AgyPluginManager {
  private readonly command: string;
  private readonly sourceDirectory: string;
  private readonly hookScriptPath: string;
  private readonly execute: AgyPluginExecutor;
  private readonly env: NodeJS.ProcessEnv | undefined;

  constructor(options: AgyPluginManagerOptions) {
    this.command = options.command;
    this.sourceDirectory = options.sourceDirectory;
    this.hookScriptPath = options.hookScriptPath;
    this.execute = options.execute;
    this.env = options.env;
  }

  async prepare(): Promise<void> {
    const sourceDirectory = this.requireSourceDirectory();
    const hookScriptPath = await this.requireHookScriptPath();
    const manifest: AgyPluginManifest = {
      name: AGY_COMPANION_PLUGIN_NAME,
    };
    const hooks = createHooks(hookScriptPath);

    try {
      await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
      await chmod(sourceDirectory, 0o700);
      await writePrivateAtomically(
        path.join(sourceDirectory, "plugin.json"),
        serialize(manifest),
      );
      await writePrivateAtomically(
        path.join(sourceDirectory, "hooks.json"),
        serialize(hooks),
      );
    } catch {
      throw new Error("AGY plugin preparation failed");
    }
  }

  async status(): Promise<AgyPluginStatus> {
    const result = await this.run("status", ["plugin", "list"]);
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const entry = stdout
      .split(/\r?\n/u)
      .find((line) => line.includes(AGY_COMPANION_PLUGIN_NAME));

    if (!entry) return "absent";
    return /\bdisabled\b/iu.test(entry) ? "disabled" : "enabled";
  }

  async install(): Promise<void> {
    const sourceDirectory = this.requireSourceDirectory();
    await this.run("validation", ["plugin", "validate", sourceDirectory]);
    await this.run("installation", ["plugin", "install", sourceDirectory]);
    await this.run("enable", ["plugin", "enable", AGY_COMPANION_PLUGIN_NAME]);
  }

  async disable(): Promise<void> {
    await this.run("disable", ["plugin", "disable", AGY_COMPANION_PLUGIN_NAME]);
  }

  async uninstall(): Promise<void> {
    await this.run("uninstall", [
      "plugin",
      "uninstall",
      AGY_COMPANION_PLUGIN_NAME,
    ]);
  }

  private requireSourceDirectory(): string {
    if (!path.isAbsolute(this.sourceDirectory)) {
      throw new Error("AGY plugin source directory must be an absolute path");
    }
    return path.resolve(this.sourceDirectory);
  }

  private async requireHookScriptPath(): Promise<string> {
    if (!path.isAbsolute(this.hookScriptPath)) {
      throw new Error("AGY plugin helper must be an absolute path");
    }
    const hookScriptPath = path.resolve(this.hookScriptPath);
    try {
      await access(hookScriptPath, fsConstants.F_OK);
    } catch {
      throw new Error("AGY plugin helper is unavailable");
    }
    try {
      await access(hookScriptPath, fsConstants.X_OK);
    } catch {
      throw new Error("AGY plugin helper is not executable");
    }
    return hookScriptPath;
  }

  private async run(
    operation: string,
    args: string[],
  ): Promise<AgyPluginExecutorResult> {
    if (this.command.trim().length === 0) {
      throw new Error("AGY plugin command is unavailable");
    }
    try {
      return await this.execute(this.command, args, {
        env: subscriptionEnvironment(this.env, undefined),
      });
    } catch {
      throw new Error(`AGY plugin ${operation} failed`);
    }
  }
}

function createHooks(hookScriptPath: string): AgyPluginHooks {
  return {
    [AGY_COMPANION_PLUGIN_NAME]: {
      PreInvocation: [hookCommand(hookScriptPath, "PreInvocation")],
      PreToolUse: [
        { matcher: "*", hooks: [hookCommand(hookScriptPath, "PreToolUse")] },
      ],
      PostToolUse: [
        { matcher: "*", hooks: [hookCommand(hookScriptPath, "PostToolUse")] },
      ],
      Stop: [hookCommand(hookScriptPath, "Stop")],
    },
  };
}

function hookCommand(
  hookScriptPath: string,
  hookName: AgyHookName,
): AgyCommandHook {
  return {
    type: "command",
    command: `${shellQuote(hookScriptPath)} ${hookName}`,
    timeout: HOOK_TIMEOUT_SECONDS,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function serialize(value: AgyPluginManifest | AgyPluginHooks): string {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

async function writePrivateAtomically(
  targetPath: string,
  content: string,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
