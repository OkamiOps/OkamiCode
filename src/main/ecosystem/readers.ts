import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Everything here reads the CLIs' own configuration. Nothing is invented:
// when a source is missing the caller gets an empty list and says so.

export interface McpServerInfo {
  name: string;
  scope: string;
  transport: string;
  detail: string;
  runtime: "claude" | "codex";
}

export interface SkillInfo {
  name: string;
  description: string;
  source: string;
}

export interface MemoryFileInfo {
  path: string;
  label: string;
  scope: "user" | "project";
  bytes: number;
}

export interface CliSettingsInfo {
  path: string;
  exists: boolean;
  keys: string[];
  effortLevel?: string;
  theme?: string;
  enabledPlugins?: string[];
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function describeServer(value: unknown): {
  transport: string;
  detail: string;
} {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  if (typeof record.url === "string") {
    return {
      transport: record.type === "sse" ? "sse" : "http",
      detail: record.url,
    };
  }
  const command = typeof record.command === "string" ? record.command : "";
  const args = Array.isArray(record.args) ? record.args.join(" ") : "";
  return { transport: "stdio", detail: `${command} ${args}`.trim() };
}

export function readMcpServers(workspacePath?: string | null): McpServerInfo[] {
  const servers: McpServerInfo[] = [];
  const claudeConfig = readJson(path.join(homedir(), ".claude.json"));
  const global = (claudeConfig?.mcpServers ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(global)) {
    servers.push({
      name,
      scope: "usuário",
      runtime: "claude",
      ...describeServer(value),
    });
  }
  const projects = (claudeConfig?.projects ?? {}) as Record<string, unknown>;
  for (const [projectPath, entry] of Object.entries(projects)) {
    if (workspacePath && projectPath !== workspacePath) continue;
    const record = entry as Record<string, unknown> | null;
    const local = (record?.mcpServers ?? {}) as Record<string, unknown>;
    for (const [name, value] of Object.entries(local)) {
      servers.push({
        name,
        scope: `projeto · ${path.basename(projectPath)}`,
        runtime: "claude",
        ...describeServer(value),
      });
    }
  }
  // Codex keeps its servers in TOML; parse the [mcp_servers.<name>] headers.
  const codexConfig = path.join(homedir(), ".codex", "config.toml");
  if (existsSync(codexConfig)) {
    const text = readFileSync(codexConfig, "utf8");
    for (const match of text.matchAll(/\[mcp_servers\.([\w.-]+)\]([^[]*)/gu)) {
      const body = match[2];
      const command = /command\s*=\s*"([^"]*)"/u.exec(body)?.[1] ?? "";
      const url = /url\s*=\s*"([^"]*)"/u.exec(body)?.[1];
      servers.push({
        name: match[1],
        scope: "Codex",
        runtime: "codex",
        transport: url ? "http" : "stdio",
        detail: url ?? command,
      });
    }
  }
  return servers;
}

function frontmatterField(text: string, field: string): string | undefined {
  const block = /^---\n([\s\S]*?)\n---/u.exec(text)?.[1];
  if (!block) return undefined;
  const line = new RegExp(`^${field}:\\s*(.+)$`, "mu").exec(block)?.[1];
  return line?.trim().replace(/^["']|["']$/gu, "");
}

export function readSkills(limit = 200): SkillInfo[] {
  const roots = [
    { dir: path.join(homedir(), ".claude", "skills"), source: "usuário" },
  ];
  const skills: SkillInfo[] = [];
  for (const root of roots) {
    if (!existsSync(root.dir)) continue;
    for (const entry of readdirSync(root.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root.dir, entry.name, "SKILL.md");
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8").slice(0, 4000);
      skills.push({
        name: frontmatterField(text, "name") ?? entry.name,
        description: frontmatterField(text, "description") ?? "",
        source: root.source,
      });
      if (skills.length >= limit) return skills;
    }
  }
  return skills;
}

export function readMemoryFiles(
  workspacePath?: string | null,
): MemoryFileInfo[] {
  const candidates: Array<{
    file: string;
    label: string;
    scope: "user" | "project";
  }> = [
    {
      file: path.join(homedir(), ".claude", "CLAUDE.md"),
      label: "CLAUDE.md do usuário",
      scope: "user",
    },
  ];
  if (workspacePath) {
    candidates.push(
      {
        file: path.join(workspacePath, "CLAUDE.md"),
        label: "CLAUDE.md do projeto",
        scope: "project",
      },
      {
        file: path.join(workspacePath, "AGENTS.md"),
        label: "AGENTS.md do projeto",
        scope: "project",
      },
    );
  }
  return candidates
    .filter((candidate) => existsSync(candidate.file))
    .map((candidate) => ({
      path: candidate.file,
      label: candidate.label,
      scope: candidate.scope,
      bytes: statSync(candidate.file).size,
    }));
}

export function readMemoryFile(file: string): string {
  return readFileSync(file, "utf8").slice(0, 256 * 1024);
}

export function writeMemoryFile(file: string, content: string): void {
  writeFileSync(file, content, "utf8");
}

export function readCliSettings(): CliSettingsInfo[] {
  const files = [
    path.join(homedir(), ".claude", "settings.json"),
    path.join(homedir(), ".codex", "config.toml"),
  ];
  return files.map((file) => {
    if (!existsSync(file)) return { path: file, exists: false, keys: [] };
    if (file.endsWith(".toml")) {
      const text = readFileSync(file, "utf8");
      return {
        path: file,
        exists: true,
        keys: [...text.matchAll(/^\[([^\]]+)\]/gmu)].map((match) => match[1]),
      };
    }
    const json = readJson(file) ?? {};
    return {
      path: file,
      exists: true,
      keys: Object.keys(json),
      effortLevel:
        typeof json.effortLevel === "string" ? json.effortLevel : undefined,
      theme: typeof json.theme === "string" ? json.theme : undefined,
      enabledPlugins: Array.isArray(json.enabledPlugins)
        ? (json.enabledPlugins as string[]).slice(0, 40)
        : undefined,
    };
  });
}
