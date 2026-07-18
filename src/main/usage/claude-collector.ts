import { spawn as nativeSpawnPty } from "node-pty";
import { claudeEnvironment } from "../runtime/claude/command";
import { UsageSourceKind, type UsageSnapshot, type UsageWindow } from "./model";

const SUPPORTED_PARSERS = new Set(["2.1.214"]);

export interface ClaudeUsageScreenResult {
  cliVersion: string;
  exitCode: number;
  output: string;
}

interface UsagePty {
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal: number }) => void): {
    dispose(): void;
  };
  write(value: string): void;
}

type SpawnUsagePty = (
  command: string,
  args: string[],
  options: {
    cols: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: string;
    rows: number;
  },
) => UsagePty;

export class ClaudeUsageParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeUsageParserError";
  }
}

export function stripAnsi(value: string): string {
  let clean = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code !== 27 && code !== 155) {
      if (code !== 13) clean += value[index];
      continue;
    }
    if (code === 27 && value[index + 1] === "]") {
      index += 2;
      while (index < value.length && value.charCodeAt(index) !== 7) index++;
      continue;
    }
    if (code === 27 && value[index + 1] === "[") index++;
    while (index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      index++;
      if (next >= 64 && next <= 126) break;
    }
  }
  return clean;
}

export function parseClaudeUsage(
  raw: string,
  options: { cliVersion: string; collectedAt?: string },
): UsageSnapshot {
  if (!SUPPORTED_PARSERS.has(options.cliVersion)) {
    throw new ClaudeUsageParserError(
      `No /usage parser for Claude CLI ${options.cliVersion}`,
    );
  }
  const text = stripAnsi(raw);
  const windows = parseWindows(text);
  if (windows.length === 0) {
    throw new ClaudeUsageParserError(
      `Claude ${options.cliVersion} /usage parser found no limit windows`,
    );
  }
  const collectedAt = options.collectedAt ?? new Date().toISOString();
  const source = {
    adapterVersion: `claude-usage-v${options.cliVersion}`,
    kind: UsageSourceKind.NativePresentational,
    method: "native /usage screen",
  };
  const contextUsed = /Context window:\s*(\d+(?:\.\d+)?)% used/iu.exec(
    text,
  )?.[1];
  return {
    accountLabel: "Claude Max",
    accountRef: "claude-main",
    collectedAt,
    credits: null,
    error: null,
    freshness: "live",
    plan: "Max",
    provider: "claude_max",
    runtime: "claude",
    sessionContext:
      contextUsed === undefined
        ? undefined
        : {
            collectedAt,
            freshness: "live",
            laneId: null,
            remainingTokens: null,
            source,
            usedPercent: Number(contextUsed),
          },
    source,
    validUntil: new Date(Date.parse(collectedAt) + 10 * 60_000).toISOString(),
    windows,
  };
}

export class ClaudeUsageCollector {
  private readonly clock: () => Date;
  private readonly spawnUsageScreen: () => Promise<ClaudeUsageScreenResult>;
  private readonly ttlMs: number;

  constructor(
    options: {
      clock?: () => Date;
      command?: string;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      spawnUsageScreen?: () => Promise<ClaudeUsageScreenResult>;
      timeoutMs?: number;
      ttlMs?: number;
    } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.spawnUsageScreen =
      options.spawnUsageScreen ??
      (() =>
        runClaudeUsageScreen({
          command: options.command,
          cwd: options.cwd,
          env: options.env,
          timeoutMs: options.timeoutMs,
        }));
  }

  async collect(options: {
    previous?: UsageSnapshot;
    reason: "overview" | "refresh";
  }): Promise<UsageSnapshot> {
    const now = this.clock();
    if (
      options.reason === "overview" &&
      options.previous &&
      now.getTime() - Date.parse(options.previous.collectedAt) <= this.ttlMs
    ) {
      return options.previous;
    }
    try {
      const result = await this.spawnUsageScreen();
      if (result.exitCode !== 0 && !result.output.trim()) {
        throw new Error(`Claude /usage PTY exited with ${result.exitCode}`);
      }
      return parseClaudeUsage(result.output, {
        cliVersion: result.cliVersion,
        collectedAt: now.toISOString(),
      });
    } catch (error) {
      const detail = message(error);
      if (options.previous) {
        return {
          ...options.previous,
          error: detail,
          freshness: "stale",
          sessionContext: options.previous.sessionContext
            ? { ...options.previous.sessionContext, freshness: "stale" }
            : undefined,
          validUntil: now.toISOString(),
        };
      }
      return unavailableClaude(now.toISOString(), detail);
    }
  }
}

export function runClaudeUsageScreen(
  options: {
    command?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    spawnPty?: SpawnUsagePty;
    timeoutMs?: number;
  } = {},
): Promise<ClaudeUsageScreenResult> {
  return new Promise((resolve, reject) => {
    const terminal = (options.spawnPty ?? nativeSpawnPty)(
      options.command ?? "claude",
      [],
      {
        cols: 100,
        cwd: options.cwd ?? process.cwd(),
        env: claudeEnvironment(options.env),
        name: "xterm-256color",
        rows: 40,
      },
    );
    let output = "";
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const hardTimer = setTimeout(() => finish(0), options.timeoutMs ?? 3_000);

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      try {
        terminal.kill();
      } catch {
        // The PTY may have exited between its final data and this cleanup.
      }
      const clean = stripAnsi(output);
      const cliVersion = /Claude Code v([\w.-]+)/u.exec(clean)?.[1];
      if (!cliVersion) {
        reject(
          new ClaudeUsageParserError("Claude /usage omitted its CLI version"),
        );
        return;
      }
      resolve({ cliVersion, exitCode, output });
    };

    terminal.onData((data) => {
      output += data;
      if (/\blimit\b[\s\S]*\bResets\b/iu.test(stripAnsi(output))) {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(0), 250);
      }
    });
    terminal.onExit(({ exitCode }) => finish(exitCode));
    terminal.write("/usage\r");
  });
}

function parseWindows(text: string): UsageWindow[] {
  const pattern =
    /(?:^|\n)(5-hour|Weekly) limit\s*\n\s*(\d+(?:\.\d+)?)% used\s*\n\s*Resets ([^\n]+)/giu;
  return [...text.matchAll(pattern)].map((match) => {
    const used = Number(match[2]);
    const resetText = match[3]?.trim() ?? "";
    const reset = Date.parse(resetText);
    const weekly = match[1]?.toLowerCase() === "weekly";
    return {
      durationMinutes: weekly ? 10_080 : 300,
      kind: weekly ? "weekly" : "five_hour",
      label: weekly ? "Semanal" : "5 horas",
      modelGroup: null,
      remainingPercent: Math.max(0, Math.min(100, 100 - used)),
      resetsAt: Number.isNaN(reset) ? null : new Date(reset).toISOString(),
      usedPercent: used,
    };
  });
}

function unavailableClaude(collectedAt: string, error: string): UsageSnapshot {
  return {
    accountLabel: "Claude Max",
    accountRef: "claude-main",
    collectedAt,
    credits: null,
    error,
    freshness: "unavailable",
    plan: null,
    provider: "claude_max",
    runtime: "claude",
    source: {
      adapterVersion: "claude-usage-v2.1.214",
      kind: UsageSourceKind.Unavailable,
      method: "native /usage screen",
    },
    validUntil: null,
    windows: [],
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
