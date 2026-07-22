import { execFile } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLIENTS = [
  "codex",
  "claude",
  "cursor",
  "agy",
  "grok",
  "minimax",
  "mimo",
] as const;
type Capability =
  | "sessions"
  | "models"
  | "effort"
  | "approvals"
  | "sandbox"
  | "mcp"
  | "hooks"
  | "subagents"
  | "background"
  | "git"
  | "worktrees"
  | "usage"
  | "automations"
  | "structured_output"
  | "app_server"
  | "checkpoints"
  | "browser"
  | "skills"
  | "launcher"
  | "plugins";

const CAPABILITIES = {
  codex: [
    "sessions",
    "models",
    "effort",
    "approvals",
    "sandbox",
    "mcp",
    "hooks",
    "subagents",
    "background",
    "git",
    "worktrees",
    "usage",
    "automations",
    "structured_output",
    "app_server",
  ],
  claude: [
    "sessions",
    "checkpoints",
    "models",
    "effort",
    "approvals",
    "sandbox",
    "browser",
    "mcp",
    "skills",
    "hooks",
    "subagents",
    "background",
    "git",
    "worktrees",
    "usage",
    "automations",
    "structured_output",
  ],
  cursor: [],
  agy: [],
  grok: [],
  minimax: [],
  mimo: [],
} as const satisfies Record<(typeof CLIENTS)[number], readonly Capability[]>;

type CliClient = (typeof CLIENTS)[number];

export interface CliCapability {
  client: CliClient;
  label: string;
  binaryPath: string | null;
  version: string | null;
  role: "runtime" | "launcher";
  integrationStatus:
    "ready" | "needs_adapter" | "update_required" | "unavailable";
  detail: string;
  capabilities: Capability[];
}

export interface CliCapabilityDetectorDependencies {
  locate(client: CliClient): string | null;
  execute(binaryPath: string, args: string[]): Promise<string>;
}

const labels: Record<CliClient, string> = {
  codex: "Codex",
  claude: "Claude Code",
  cursor: "Cursor",
  agy: "Antigravity",
  grok: "Grok",
  minimax: "MiniMax mmx",
  mimo: "MiMo Code",
};

function roleFor(client: CliClient): "runtime" | "launcher" {
  return client === "minimax" ? "launcher" : "runtime";
}

export function localBinaryCandidates(client: CliClient): string[] {
  const binary =
    client === "cursor"
      ? "cursor-agent"
      : client === "minimax"
        ? "mmx"
        : client;
  const fromPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, binary));
  const appResources = process.resourcesPath
    ? [path.join(process.resourcesPath, "bin", binary)]
    : [];
  const cursorCandidates =
    client === "cursor"
      ? ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor-agent"]
      : [];
  const mimoCandidates =
    client === "mimo" ? [path.join(homedir(), ".mimocode", "bin", "mimo")] : [];
  const nvmCandidates = client === "minimax" ? nvmBinaryCandidates(binary) : [];

  return [
    ...fromPath,
    path.join(homedir(), ".local", "bin", binary),
    path.join(homedir(), ".cargo", "bin", binary),
    ...cursorCandidates,
    ...mimoCandidates,
    ...nvmCandidates,
    ...appResources,
    path.join(path.dirname(process.execPath), binary),
    `/opt/homebrew/bin/${binary}`,
    `/usr/local/bin/${binary}`,
    `/usr/bin/${binary}`,
  ];
}

function nvmBinaryCandidates(binary: string): string[] {
  const root = path.join(homedir(), ".nvm", "versions", "node");
  let versions: string[] = [];
  try {
    versions = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true }),
      );
  } catch {
    // NVM is optional; the regular PATH candidates remain authoritative.
  }
  return [
    path.join(homedir(), ".nvm", "current", "bin", binary),
    ...versions.map((version) => path.join(root, version, "bin", binary)),
  ];
}

export function locateLocalBinary(client: CliClient): string | null {
  for (const candidate of localBinaryCandidates(client)) {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
      return realpathSync(candidate);
    } catch {
      // A stale PATH entry or unavailable packaged resource is not a client.
    }
  }
  return null;
}

function outputFromProbeError(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const output = error as Record<string, unknown>;
  const text = [output.stdout, output.stderr]
    .map((value) => {
      if (typeof value === "string") return value;
      if (Buffer.isBuffer(value)) return value.toString("utf8");
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return text.trim().length > 0 ? text : null;
}

export async function executeProbe(
  binaryPath: string,
  args: string[],
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      env: process.env,
      timeout: 5_000,
      windowsHide: true,
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    const output = outputFromProbeError(error);
    if (output !== null) return output;
    throw error;
  }
}

function versionFrom(output: string): string | null {
  return (
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function helpHasLiteral(help: string, literal: string): boolean {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^\\w-])${escaped}(?=$|[^\\w-])`, "iu").test(help);
}

function helpHasCommand(help: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `^\\s*(?:cursor-agent\\s+)?${escaped}(?=\\s|$)`,
    "imu",
  ).test(help);
}

function helpHasPrefixedCommand(
  help: string,
  prefix: string,
  command: string,
): boolean {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `^\\s*(?:${escapedPrefix}\\s+)?${escapedCommand}(?=\\s|$)`,
    "imu",
  ).test(help);
}

function helpHasOption(help: string, option: string): boolean {
  return helpHasLiteral(help, option);
}

function helpHasCommandOrOption(help: string, name: string): boolean {
  return helpHasCommand(help, name) || helpHasOption(help, `--${name}`);
}

function cursorProtocolReady(help: string): boolean {
  return (
    helpHasOption(help, "--print") &&
    helpHasOption(help, "--output-format") &&
    helpHasLiteral(help, "stream-json") &&
    helpHasOption(help, "--stream-partial-output") &&
    helpHasOption(help, "--resume") &&
    helpHasOption(help, "--mode") &&
    helpHasOption(help, "--auto-review") &&
    helpHasOption(help, "--sandbox") &&
    helpHasCommand(help, "create-chat")
  );
}

function cursorCapabilities(help: string): Capability[] {
  const capabilities: Capability[] = [];
  const add = (capability: Capability, present: boolean) => {
    if (present) capabilities.push(capability);
  };

  add(
    "sessions",
    helpHasOption(help, "--resume") && helpHasCommand(help, "create-chat"),
  );
  add("checkpoints", helpHasCommandOrOption(help, "checkpoints"));
  add("models", helpHasOption(help, "--model"));
  add(
    "approvals",
    ["--approval-mode", "--permission-mode", "--ask-before-tool"].some(
      (option) => helpHasOption(help, option),
    ),
  );
  add("sandbox", helpHasCommandOrOption(help, "sandbox"));
  add("browser", helpHasCommandOrOption(help, "browser"));
  add("mcp", helpHasCommandOrOption(help, "mcp"));
  add("skills", helpHasCommandOrOption(help, "skills"));
  add("hooks", helpHasCommandOrOption(help, "hooks"));
  add(
    "subagents",
    helpHasCommandOrOption(help, "subagent") ||
      helpHasCommandOrOption(help, "subagents"),
  );
  add("background", helpHasOption(help, "--background"));
  add("git", helpHasCommandOrOption(help, "git"));
  add(
    "worktrees",
    helpHasCommandOrOption(help, "worktree") ||
      helpHasCommandOrOption(help, "worktrees"),
  );
  add(
    "usage",
    helpHasCommandOrOption(help, "usage") ||
      helpHasCommandOrOption(help, "quota"),
  );
  add("automations", helpHasCommandOrOption(help, "automations"));
  add(
    "structured_output",
    helpHasOption(help, "--output-format") &&
      helpHasLiteral(help, "stream-json"),
  );
  add("app_server", helpHasCommandOrOption(help, "app-server"));
  add(
    "plugins",
    helpHasCommandOrOption(help, "plugin") ||
      helpHasCommandOrOption(help, "plugins"),
  );

  return capabilities;
}

function agyCapabilities(help: string): Capability[] {
  const capabilities: Capability[] = [];
  const add = (capability: Capability, present: boolean) => {
    if (present) capabilities.push(capability);
  };

  add(
    "sessions",
    helpHasOption(help, "--conversation") || helpHasOption(help, "--continue"),
  );
  add(
    "models",
    helpHasOption(help, "--model") || helpHasCommand(help, "models"),
  );
  add("sandbox", helpHasOption(help, "--sandbox"));
  add(
    "plugins",
    helpHasCommand(help, "plugin") || helpHasCommand(help, "plugins"),
  );

  // Listing selectable CLI agents does not establish nested subagent execution,
  // and a force-skip switch is not a human approval workflow.
  return capabilities;
}

async function detectClient(
  client: CliClient,
  dependencies: CliCapabilityDetectorDependencies,
): Promise<CliCapability> {
  const binaryPath = dependencies.locate(client);
  if (!binaryPath) {
    return {
      client,
      label: labels[client],
      binaryPath: null,
      version: null,
      role: roleFor(client),
      integrationStatus: "unavailable",
      detail:
        client === "minimax"
          ? "mmx não encontrado. Instale o CLI oficial do Token Plan com npm install -g mmx-cli."
          : "CLI não encontrado neste computador.",
      capabilities: [],
    };
  }

  let version: string | null = null;
  try {
    version = versionFrom(
      await dependencies.execute(binaryPath, ["--version"]),
    );
  } catch {
    // The executable still exists; state only what the local probe established.
  }

  if (client === "codex" || client === "claude") {
    return {
      client,
      label: labels[client],
      binaryPath,
      version,
      role: "runtime",
      integrationStatus: "ready",
      detail: "CLI encontrado e integrado ao runtime do Workbench.",
      capabilities: [...CAPABILITIES[client]],
    };
  }

  if (client === "cursor") {
    let agentHelp = "";
    try {
      agentHelp = await dependencies.execute(binaryPath, ["--help"]);
    } catch {
      // A failed help probe cannot prove runtime protocol compatibility.
    }
    const protocolReady = cursorProtocolReady(agentHelp);
    return {
      client,
      label: labels[client],
      binaryPath,
      version,
      role: protocolReady ? "runtime" : "launcher",
      integrationStatus: protocolReady ? "ready" : "needs_adapter",
      detail: protocolReady
        ? "CLI cursor-agent encontrado e protocolo stream-json compatível com o runtime."
        : "CLI cursor-agent encontrado, mas o protocolo necessário não foi comprovado pelo --help.",
      capabilities: cursorCapabilities(agentHelp),
    };
  }

  if (client === "grok") {
    let help = "";
    try {
      help = await dependencies.execute(binaryPath, ["--help"]);
    } catch {
      // A failed help probe cannot prove the native streaming protocol.
    }
    const protocolReady =
      helpHasOption(help, "--output-format") &&
      helpHasLiteral(help, "streaming-json") &&
      helpHasOption(help, "--resume") &&
      helpHasOption(help, "--session-id") &&
      helpHasCommand(help, "models");
    return {
      client,
      label: labels.grok,
      binaryPath,
      version,
      role: "runtime",
      integrationStatus: protocolReady ? "ready" : "needs_adapter",
      detail: protocolReady
        ? "Grok CLI encontrado com sessões, catálogo e streaming-json nativos."
        : "Grok CLI encontrado, mas o protocolo streaming-json não foi comprovado.",
      capabilities: protocolReady
        ? [
            "sessions",
            "models",
            "effort",
            "approvals",
            "sandbox",
            "mcp",
            "hooks",
            "subagents",
            "background",
            "git",
            "worktrees",
            "usage",
            "structured_output",
            "plugins",
          ]
        : [],
    };
  }

  if (client === "minimax") {
    let help = "";
    try {
      help = await dependencies.execute(binaryPath, ["--help"]);
    } catch {
      // A failed help probe still leaves the executable visible to the user.
    }
    const textReady =
      helpHasLiteral(help, "text") || helpHasCommand(help, "resources");
    return {
      client,
      label: labels.minimax,
      binaryPath,
      version,
      role: "launcher",
      integrationStatus: textReady ? "ready" : "needs_adapter",
      detail: textReady
        ? "MiniMax mmx encontrado; disponível para ações de texto e mídia do Token Plan, sem catálogo nem harness de workspace."
        : "MiniMax CLI encontrado, mas os comandos do Token Plan não foram comprovados.",
      capabilities: textReady ? ["usage", "launcher"] : [],
    };
  }

  if (client === "mimo") {
    let help = "";
    try {
      help = await dependencies.execute(binaryPath, ["--help"]);
    } catch {
      // A failed help probe cannot establish the native protocol surface.
    }
    const capabilities: Capability[] = [];
    if (helpHasPrefixedCommand(help, "mimo", "session"))
      capabilities.push("sessions");
    if (helpHasPrefixedCommand(help, "mimo", "models"))
      capabilities.push("models");
    if (helpHasOption(help, "--variant")) capabilities.push("effort");
    if (helpHasPrefixedCommand(help, "mimo", "mcp")) capabilities.push("mcp");
    if (helpHasLiteral(help, "--format") && helpHasLiteral(help, "json"))
      capabilities.push("structured_output");
    const catalogReady = capabilities.includes("models");
    return {
      client,
      label: labels.mimo,
      binaryPath,
      version,
      role: "runtime",
      integrationStatus: "needs_adapter",
      detail: catalogReady
        ? "MiMo Code encontrado; catálogo nativo disponível e adapter de execução ainda não integrado."
        : "MiMo Code encontrado, mas o comando models não foi comprovado.",
      capabilities,
    };
  }

  let agyHelp = "";
  try {
    agyHelp = await dependencies.execute(binaryPath, ["--help"]);
  } catch {
    // A failed help probe cannot establish AGY launcher capabilities.
  }

  return {
    client,
    label: labels.agy,
    binaryPath,
    version,
    role: "runtime",
    integrationStatus: "needs_adapter",
    detail:
      "CLI encontrado; companion local de hooks JSON ainda precisa estar habilitado.",
    capabilities: agyCapabilities(agyHelp),
  };
}

export function createCliCapabilityDetector(
  dependencies: CliCapabilityDetectorDependencies = {
    locate: locateLocalBinary,
    execute: executeProbe,
  },
): () => Promise<CliCapability[]> {
  return () =>
    Promise.all(CLIENTS.map((client) => detectClient(client, dependencies)));
}
