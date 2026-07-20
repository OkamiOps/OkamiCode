import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLIENTS = ["codex", "claude", "cursor", "agy"] as const;
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
  cursor: ["launcher", "mcp"],
  agy: ["sessions", "models", "approvals", "sandbox", "subagents", "plugins"],
} as const;

type CliClient = (typeof CLIENTS)[number];
type Capability = (typeof CAPABILITIES)[CliClient][number];

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
  agy: "AGY",
};

function roleFor(client: CliClient): "runtime" | "launcher" {
  return client === "codex" || client === "claude" ? "runtime" : "launcher";
}

function localBinaryCandidates(client: CliClient): string[] {
  const binary = client;
  const fromPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, binary));
  const appResources = process.resourcesPath
    ? [path.join(process.resourcesPath, "bin", binary)]
    : [];
  const cursorCandidates =
    client === "cursor"
      ? ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"]
      : [];

  return [
    ...fromPath,
    path.join(homedir(), ".local", "bin", binary),
    path.join(homedir(), ".cargo", "bin", binary),
    ...cursorCandidates,
    ...appResources,
    path.join(path.dirname(process.execPath), binary),
    `/opt/homebrew/bin/${binary}`,
    `/usr/local/bin/${binary}`,
    `/usr/bin/${binary}`,
  ];
}

function locateLocalBinary(client: CliClient): string | null {
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

async function executeProbe(
  binaryPath: string,
  args: string[],
): Promise<string> {
  const { stdout, stderr } = await execFileAsync(binaryPath, args, {
    env: process.env,
    timeout: 5_000,
    windowsHide: true,
  });
  return `${stdout}\n${stderr}`;
}

function versionFrom(output: string): string | null {
  return (
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function cursorAgentNeedsUpdate(help: string): boolean {
  return /(?:update|upgrade).{0,80}cursor|requires?\s+cursor\s+(?:version\s*)?\d|cursor\s+(?:version\s*)?\d[^\n]*(?:or later|or newer)/iu.test(
    help,
  );
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
      detail: "CLI não encontrado neste computador.",
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
      agentHelp = await dependencies.execute(binaryPath, ["agent", "--help"]);
    } catch {
      // A missing/failed help probe does not prove that a newer Cursor exists.
    }
    const updateRequired = cursorAgentNeedsUpdate(agentHelp);
    return {
      client,
      label: labels[client],
      binaryPath,
      version,
      role: "launcher",
      integrationStatus: updateRequired ? "update_required" : "needs_adapter",
      detail: updateRequired
        ? "CLI encontrado, mas o comando agent indica uma versão antiga do Cursor."
        : "CLI encontrado; a integração de runtime ainda não existe.",
      capabilities: [...CAPABILITIES.cursor],
    };
  }

  return {
    client,
    label: labels.agy,
    binaryPath,
    version,
    role: "launcher",
    integrationStatus: "needs_adapter",
    detail: "CLI encontrado; aguarda adaptador com saída estruturada.",
    capabilities: [...CAPABILITIES.agy],
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
