import {
  type Dirent,
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
  category: string;
  invocation: string;
  runtimes: Array<"claude" | "codex">;
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

interface SkillRoot {
  dir: string;
  source: string;
  runtimes: Array<"claude" | "codex">;
  pluginRuntime?: "claude" | "codex";
}

export function readSkills(
  workspacePath?: string | null,
  limit = 1_500,
  home = homedir(),
): SkillInfo[] {
  const roots: SkillRoot[] = [];
  if (workspacePath) {
    roots.push(
      {
        dir: path.join(workspacePath, ".agents", "skills"),
        source: "projeto · compartilhada",
        runtimes: ["claude", "codex"],
      },
      {
        dir: path.join(workspacePath, ".codex", "skills"),
        source: "projeto · Codex",
        runtimes: ["codex"],
      },
      {
        dir: path.join(workspacePath, ".claude", "skills"),
        source: "projeto · Claude",
        runtimes: ["claude"],
      },
    );
  }
  roots.push(
    {
      dir: path.join(home, ".agents", "skills"),
      source: "pessoal · compartilhada",
      runtimes: ["claude", "codex"],
    },
    {
      dir: path.join(home, ".codex", "skills"),
      source: "pessoal · Codex",
      runtimes: ["codex"],
    },
    {
      dir: path.join(home, ".claude", "skills"),
      source: "pessoal · Claude",
      runtimes: ["claude"],
    },
    {
      dir: path.join(home, ".codex", "plugins", "cache"),
      source: "plugin · Codex",
      runtimes: ["codex"],
      pluginRuntime: "codex",
    },
    {
      dir: path.join(home, ".claude", "plugins", "cache"),
      source: "plugin · Claude",
      runtimes: ["claude"],
      pluginRuntime: "claude",
    },
  );

  const skills = new Map<string, SkillInfo>();
  for (const root of roots) {
    visitSkillRoot(root.dir, root, root.dir, 0, (file, plugin) => {
      if (skills.size >= limit) return false;
      let text: string;
      try {
        text = readFileSync(file, "utf8").slice(0, 8_000);
      } catch {
        return true;
      }
      const directoryName = path.basename(path.dirname(file));
      const name = frontmatterField(text, "name") ?? directoryName;
      const invocation = name.trim().replace(/\s+/gu, "-");
      const runtimes = [...root.runtimes].sort() as Array<"claude" | "codex">;
      const key = invocation.toLowerCase();
      const existing = skills.get(key);
      if (existing) {
        existing.runtimes = [
          ...new Set([...existing.runtimes, ...runtimes]),
        ].sort() as Array<"claude" | "codex">;
      } else {
        const description = frontmatterField(text, "description") ?? "";
        skills.set(key, {
          name,
          description,
          source: plugin
            ? `${root.source} · ${humanizeSkillName(plugin)}`
            : root.source,
          category: inferSkillCategory(name, description, plugin),
          invocation,
          runtimes,
        });
      }
      return true;
    });
    if (skills.size >= limit) break;
  }

  return [...skills.values()].sort(
    (left, right) =>
      left.category.localeCompare(right.category, "pt-BR") ||
      left.name.localeCompare(right.name, "pt-BR") ||
      left.source.localeCompare(right.source, "pt-BR"),
  );
}

function visitSkillRoot(
  dir: string,
  root: SkillRoot,
  rootDir: string,
  depth: number,
  visit: (file: string, plugin?: string) => boolean,
): boolean {
  if (depth > 8 || !existsSync(dir)) return true;
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!visitSkillRoot(full, root, rootDir, depth + 1, visit)) return false;
      continue;
    }
    if (!entry.isFile() || entry.name !== "SKILL.md") continue;
    const relative = path.relative(rootDir, full).split(path.sep);
    const skillsIndex = relative.lastIndexOf("skills");
    const plugin = root.pluginRuntime
      ? relative[Math.max(0, skillsIndex - 2)]
      : undefined;
    if (!visit(full, plugin)) return false;
  }
  return true;
}

function humanizeSkillName(value: string): string {
  return value
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function inferSkillCategory(
  name: string,
  description: string,
  plugin?: string,
): string {
  const value = `${name} ${description} ${plugin ?? ""}`.toLowerCase();
  const categories: Array<[RegExp, string]> = [
    [/frontend|design|figma|canvas|canva|ui|ux|brand/iu, "Design"],
    [/marketing|campaign|seo|content|copywrit/iu, "Marketing"],
    [/sales|crm|lead|account|apollo/iu, "Sales"],
    [/finance|financial|investment|equity|payroll/iu, "Finance"],
    [/legal|compliance|contract|risk assessment/iu, "Legal"],
    [
      /human resource|people|performance review|onboarding/iu,
      "Human Resources",
    ],
    [/support|inbox|gmail|outlook|email|slack|telegram/iu, "Communication"],
    [
      /data|analytics|metric|spreadsheet|excel|database|postgres|supabase/iu,
      "Data",
    ],
    [/product|roadmap|linear|notion|planning|kanban/iu, "Product Management"],
    [/code review|debug|test|ci|github|git|security/iu, "Code review"],
    [
      /cloudflare|vercel|worker|api|sdk|agent|engineering|system|sandbox/iu,
      "Engineering",
    ],
    [/document|pdf|slide|presentation|docx|markdown/iu, "Productivity"],
    [/calendar|meeting|schedule|operation|capacity/iu, "Operations"],
    [/hyperframe|remotion|video|media|animation/iu, "Hyperframes"],
    [/skill|plugin|mcp|superpower/iu, "AI plugins"],
  ];
  return categories.find(([pattern]) => pattern.test(value))?.[1] ?? "Outros";
}

export interface AgentInfo {
  name: string;
  description: string;
  source: string;
  model?: string;
  tools?: string;
}

// Agents ship inside plugin marketplaces and project folders; both are read
// from their own definition files so the list matches what the CLI loads.
export function readAgents(workspacePath?: string | null): AgentInfo[] {
  const roots: Array<{ dir: string; source: string }> = [
    { dir: path.join(homedir(), ".claude", "agents"), source: "usuário" },
    {
      dir: path.join(homedir(), ".claude", "plugins", "marketplaces"),
      source: "plugin",
    },
  ];
  if (workspacePath) {
    roots.push({
      dir: path.join(workspacePath, ".claude", "agents"),
      source: "projeto",
    });
  }
  const agents = new Map<string, AgentInfo>();
  const visit = (dir: string, source: string, depth: number): void => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full, source, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      if (!dir.endsWith(`${path.sep}agents`)) continue;
      const text = readFileSync(full, "utf8").slice(0, 6000);
      const name = frontmatterField(text, "name") ?? entry.name.slice(0, -3);
      if (agents.has(name)) continue;
      agents.set(name, {
        name,
        description: frontmatterField(text, "description") ?? "",
        source,
        model: frontmatterField(text, "model"),
        tools: frontmatterField(text, "tools"),
      });
    }
  };
  for (const root of roots) visit(root.dir, root.source, 0);
  return [...agents.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
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
