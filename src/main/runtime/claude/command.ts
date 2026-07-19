import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertNoAnthropicCredentials,
  type GatewayProfile,
} from "../../gateway/profile";

const execFileAsync = promisify(execFile);
const REQUIRED_FLAGS = [
  "--print",
  "--input-format",
  "--output-format",
  "--include-partial-messages",
  "--include-hook-events",
  "--replay-user-messages",
  "--permission-mode",
  "--settings",
  "--session-id",
  "--resume",
  "--model",
  "--verbose",
] as const;
const SUPPORTED_VERSIONS = new Set(["2.1.212", "2.1.214"]);
const GATEWAY_CONFIG_DIRECTORY_PREFIX = "okami-claude-gateway-";
const DEGRADED_DENY = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
];

export interface ClaudeArgsOptions {
  settingsPath: string;
  sessionId?: string;
  resumeId?: string;
  model?: string;
}

export interface ClaudeCapabilities {
  mode: "ready" | "degraded";
  supported: boolean;
  version: string | null;
  missingCapabilities: string[];
  detail?: string;
}

export interface ClaudeSettingsOptions {
  allowedWorkspaces: string[];
  hookScriptPath: string;
  degraded: boolean;
}

export interface ClaudeGatewayEnvironmentOptions {
  profile: GatewayProfile;
  port: number;
  bearerToken: string;
  model: string;
  // Stable per-lane config dir: required for native session resume to work,
  // since the conversation history lives inside CLAUDE_CONFIG_DIR.
  stableConfigDirectory?: string;
}

export interface ClaudeSettings {
  permissions: {
    additionalDirectories: string[];
    deny: string[];
  };
  disableBypassPermissionsMode: "disable";
  hooks: {
    PreToolUse: HookMatcher[];
    PostToolUse: HookMatcher[];
  };
}

interface HookMatcher {
  matcher: string;
  hooks: Array<{
    type: "command";
    command: string;
    args: string[];
    timeout: number;
  }>;
}

export function claudeArgs(options: ClaudeArgsOptions): string[] {
  if (Boolean(options.sessionId) === Boolean(options.resumeId)) {
    throw new Error("Claude requires exactly one of sessionId or resumeId");
  }

  const binding = options.sessionId
    ? ["--session-id", options.sessionId]
    : ["--resume", options.resumeId as string];
  return [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--include-hook-events",
    "--replay-user-messages",
    "--permission-mode",
    "manual",
    "--settings",
    options.settingsPath,
    ...binding,
    ...(options.model ? ["--model", options.model] : []),
  ];
}

export function claudeEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.ANTHROPIC_API_KEY;
  delete environment.ANTHROPIC_AUTH_TOKEN;
  delete environment.ANTHROPIC_BASE_URL;
  delete environment.ANTHROPIC_CUSTOM_HEADERS;
  delete environment.ANTHROPIC_CUSTOM_MODEL_OPTION;
  delete environment.ANTHROPIC_MODEL;
  delete environment.OPENAI_API_KEY;
  return environment;
}

export function claudeGatewayEnvironment(
  options: ClaudeGatewayEnvironmentOptions,
): NodeJS.ProcessEnv {
  assertNoAnthropicCredentials(options.profile);
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  ) {
    throw new Error("Gateway port must be a valid TCP port");
  }
  if (!options.bearerToken) throw new Error("Gateway bearer token is required");
  if (!options.model) throw new Error("Gateway model is required");
  let configDirectory: string;
  if (options.stableConfigDirectory) {
    configDirectory = path.resolve(options.stableConfigDirectory);
    mkdirSync(configDirectory, { mode: 0o700, recursive: true });
  } else {
    configDirectory = mkdtempSync(
      path.join(os.tmpdir(), GATEWAY_CONFIG_DIRECTORY_PREFIX),
    );
  }
  chmodSync(configDirectory, 0o700);
  return {
    ...claudeEnvironment(options.profile.env),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${options.port}/${encodeURIComponent(options.profile.id)}`,
    // This authenticates only to Okami's loopback gateway, not to Anthropic.
    ANTHROPIC_AUTH_TOKEN: options.bearerToken,
    ANTHROPIC_CUSTOM_MODEL_OPTION: options.model,
    // Isolation keeps global SessionStart hooks/settings out of gateway lanes and
    // guarantees the user's Claude subscription OAuth token never reaches the gateway.
    // The per-session --settings file remains active independently via its CLI flag.
    CLAUDE_CONFIG_DIR: configDirectory,
  };
}

export function ownedClaudeGatewayConfigDirectory(
  environment: NodeJS.ProcessEnv | undefined,
): string | undefined {
  const candidate = environment?.CLAUDE_CONFIG_DIR;
  if (
    !candidate ||
    !environment.ANTHROPIC_BASE_URL?.startsWith("http://127.0.0.1:") ||
    !environment.ANTHROPIC_AUTH_TOKEN
  ) {
    return undefined;
  }
  const resolved = path.resolve(candidate);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith(GATEWAY_CONFIG_DIRECTORY_PREFIX)
  ) {
    return undefined;
  }
  return resolved;
}

export function assessClaudeCapabilities(
  versionOutput: string,
  helpOutput: string,
): ClaudeCapabilities {
  const version = /\b(\d+\.\d+\.\d+)\b/u.exec(versionOutput)?.[1] ?? null;
  const missingCapabilities: string[] = REQUIRED_FLAGS.filter(
    (flag) => !helpOutput.includes(flag),
  );
  if (version === null || !SUPPORTED_VERSIONS.has(version)) {
    missingCapabilities.unshift(`supported-version:${version ?? "unknown"}`);
  }
  const supported = missingCapabilities.length === 0;
  return {
    mode: supported ? "ready" : "degraded",
    supported,
    version,
    missingCapabilities,
    detail: supported
      ? undefined
      : `Claude adapter degraded: capability probe failed (${missingCapabilities.join(", ")})`,
  };
}

export async function probeClaudeCapabilities(
  command = "claude",
  environment: NodeJS.ProcessEnv = {},
): Promise<ClaudeCapabilities> {
  const env = claudeEnvironment(environment);
  let versionOutput: string;
  try {
    ({ stdout: versionOutput } = await execFileAsync(command, ["--version"], {
      env,
    }));
  } catch (error) {
    return {
      mode: "degraded",
      supported: false,
      version: null,
      missingCapabilities: [...REQUIRED_FLAGS],
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    const { stdout: help } = await execFileAsync(command, ["--help"], { env });
    return assessClaudeCapabilities(versionOutput, help);
  } catch (error) {
    const degraded = assessClaudeCapabilities(versionOutput, "");
    return {
      ...degraded,
      detail: `Claude adapter degraded: help probe failed (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

export function createClaudeSettings(
  options: ClaudeSettingsOptions,
): ClaudeSettings {
  const hookScriptPath = absoluteSafePath(
    options.hookScriptPath,
    "hook script",
  );
  const additionalDirectories = Array.from(
    new Set(
      options.allowedWorkspaces.map((workspace) =>
        absoluteSafePath(workspace, "workspace"),
      ),
    ),
  );
  if (additionalDirectories.length === 0) {
    throw new Error("At least one allowlisted workspace is required");
  }

  const handler = {
    type: "command" as const,
    command: hookScriptPath,
    args: [],
    timeout: 30,
  };
  return {
    permissions: {
      additionalDirectories,
      deny: options.degraded ? [...DEGRADED_DENY] : [],
    },
    disableBypassPermissionsMode: "disable",
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ ...handler }] }],
      PostToolUse: [{ matcher: "*", hooks: [{ ...handler }] }],
    },
  };
}

function absoluteSafePath(candidate: string, label: string): string {
  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(candidate) || resolved === path.parse(resolved).root) {
    throw new Error(`${label} must be an absolute, non-root path`);
  }
  return resolved;
}
