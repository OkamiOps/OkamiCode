import { spawn as nativeSpawnPty } from "node-pty";
import { homedir } from "node:os";
import path from "node:path";
import { locateLocalBinary } from "../ecosystem/cli-capabilities";
import { claudeEnvironment } from "../runtime/claude/command";
import { UsageSourceKind, type UsageSnapshot, type UsageWindow } from "./model";

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
  // The version banner is cosmetic; refusing to parse without it left the
  // whole panel empty. The screen shape is what matters.
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
  const contextUsed = /Contextwindow:(\d+(?:\.\d+)?)%used/iu.exec(
    text.replace(/\s+/gu, ""),
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
      options.previous.freshness === "live" &&
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
    locateCommand?: () => string | null;
    timeoutMs?: number;
  } = {},
): Promise<ClaudeUsageScreenResult> {
  return new Promise((resolve) => {
    const terminal = (options.spawnPty ?? nativeSpawnPty)(
      options.command ??
        options.locateCommand?.() ??
        locateLocalBinary("claude") ??
        "claude",
      [],
      {
        cols: 100,
        // A packaged app launched by Finder does not inherit a project cwd.
        // OkamiWorkspace is created by the app and is the neutral, trusted
        // workspace used by the desktop shell when no project is selected.
        cwd: options.cwd ?? path.join(homedir(), "OkamiWorkspace"),
        env: claudeEnvironment(options.env),
        name: "xterm-256color",
        rows: 40,
      },
    );
    let output = "";
    let settled = false;
    // The CLI boots through optional modals (fullscreen renderer, folder
    // trust) and only then shows a prompt, so the scrape is a small state
    // machine instead of a blind write.
    let stage: "boot" | "asked" | "done" = "boot";
    let trustHandled = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const hardTimer = setTimeout(() => finish(0), options.timeoutMs ?? 45_000);

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
      const cliVersion =
        /Claude Code v([\w.-]+)/u.exec(clean)?.[1] ?? "unknown";
      resolve({ cliVersion, exitCode, output });
    };

    const ask = () => {
      if (stage !== "boot") return;
      stage = "asked";
      setTimeout(() => terminal.write("/usage\r"), 400);
    };

    terminal.onData((data) => {
      output += data;
      // Cursor-positioned redraws drop the spaces, so markers are matched
      // against a whitespace-free copy of the screen.
      const compact = stripAnsi(output).replace(/\s+/gu, "");
      if (stage === "boot") {
        if (!trustHandled && /Notnow|trustthisfolder/iu.test(compact)) {
          trustHandled = true;
          // OkamiWorkspace is created and owned by this app. Claude defaults
          // to option 1 (trust); pressing Enter avoids the old bug where "2"
          // selected "No, exit" and /usage was written to a dead PTY.
          terminal.write("\r");
          setTimeout(ask, 900);
          return;
        }
        if (/forshortcuts|manualmodeon/iu.test(compact)) ask();
      }
      if ((stage === "asked" || stage === "done") && /%used/u.test(compact)) {
        stage = "done";
        if (quietTimer) clearTimeout(quietTimer);
        // Claude paints session, weekly and per-model limits in separate
        // redraws. Resetting this timer on every redraw avoids capturing only
        // the first row and incorrectly preserving an older snapshot.
        quietTimer = setTimeout(() => finish(0), 1_500);
      }
    });
    terminal.onExit(({ exitCode }) => finish(exitCode));
  });
}

// The /usage screen is redrawn with cursor moves, so the PTY stream loses
// its spaces ("91% used" arrives as "91%used"). Matching a compacted copy is
// what makes this parseable at all.
export function parseWindows(text: string): UsageWindow[] {
  const compact = text.replace(/\s+/gu, "");
  const pattern =
    /Current(session|week)(?:\(([^)]{0,40})\))?[^%]{0,2000}?(\d{1,3})%used(?:(?:Resets|Reinicia)([A-Za-zÀ-ÿ0-9:.,]{0,30}))?/giu;
  const seen = new Set<string>();
  const windows: UsageWindow[] = [];
  for (const match of compact.matchAll(pattern)) {
    const weekly = match[1].toLowerCase() === "week";
    const rawGroup = match[2] ?? "";
    const allModels = /allmodels/iu.test(rawGroup) || rawGroup === "";
    const modelGroup = weekly && !allModels ? rawGroup : null;
    const used = Number(match[3]);
    const key = `${weekly ? "weekly" : "session"}:${modelGroup ?? "all"}`;
    if (seen.has(key) || !Number.isFinite(used)) continue;
    seen.add(key);
    windows.push({
      durationMinutes: weekly ? 10_080 : 300,
      kind: weekly ? "weekly" : "five_hour",
      label: weekly
        ? modelGroup
          ? `Semanal · ${modelGroup}`
          : "Semanal"
        : "Sessão (5h)",
      modelGroup,
      remainingPercent: Math.max(0, Math.min(100, 100 - used)),
      resetsAt: parseResetStamp(match[4]),
      usedPercent: Math.max(0, Math.min(100, used)),
    });
  }
  return windows;
}

// Stamps arrive compacted ("Jul22at9:59am", "6:39pm"); anything ambiguous
// stays null rather than inventing a date.
function parseResetStamp(value: string | undefined): string | null {
  if (!value) return null;
  const now = new Date();
  const full = /^([A-Za-z]{3})(\d{1,2})at(\d{1,2})(?::(\d{2}))?(am|pm)$/iu.exec(
    value,
  );
  const timeOnly = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/iu.exec(value);
  const toHour = (hour: number, suffix: string) => {
    const lower = suffix.toLowerCase();
    if (lower === "pm" && hour !== 12) return hour + 12;
    if (lower === "am" && hour === 12) return 0;
    return hour;
  };
  if (full) {
    const month = new Date(`${full[1]} 1, 2000`).getMonth();
    if (Number.isNaN(month)) return null;
    const date = new Date(
      now.getFullYear(),
      month,
      Number(full[2]),
      toHour(Number(full[3]), full[5]),
      Number(full[4] ?? 0),
    );
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  // Localised screens report a weekday instead of a date ("qua.,09:59").
  const weekday = /^([A-Za-zÀ-ÿ]{3})\.?,?(\d{1,2}):(\d{2})$/u.exec(value);
  if (weekday) {
    const names = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    const index = names.indexOf(weekday[1].toLowerCase());
    if (index >= 0) {
      const date = new Date(now);
      date.setHours(Number(weekday[2]), Number(weekday[3]), 0, 0);
      const delta = (index - date.getDay() + 7) % 7;
      date.setDate(date.getDate() + delta);
      if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 7);
      return date.toISOString();
    }
  }
  if (timeOnly) {
    const date = new Date(now);
    date.setHours(
      toHour(Number(timeOnly[1]), timeOnly[3]),
      Number(timeOnly[2] ?? 0),
      0,
      0,
    );
    if (date.getTime() < now.getTime()) date.setDate(date.getDate() + 1);
    return date.toISOString();
  }
  return null;
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
