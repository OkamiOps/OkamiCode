import { spawn as nativeSpawnPty } from "node-pty";
import { homedir } from "node:os";
import path from "node:path";
import { locateLocalBinary } from "../ecosystem/cli-capabilities";
import { UsageSourceKind, type UsageSnapshot } from "./model";
import { compactScreen } from "./native-usage-screen";

interface AgyUsageResult {
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

export function parseAgyUsage(
  raw: string,
  options: { cliVersion: string; collectedAt: string },
): UsageSnapshot {
  const compact = compactScreen(raw);
  const accountRef = /Account:\s*([^\s]+@[^\s]+)/iu.exec(
    raw.replace(/\r/gu, ""),
  )?.[1];
  const plan = /\((GoogleAI(?:Pro|Ultra)?)\)/iu.exec(compact)?.[1] ?? null;
  const groups = [
    {
      end: "CLAUDEANDGPTMODELS",
      heading: "GEMINIMODELS",
      label: "Gemini",
    },
    { end: null, heading: "CLAUDEANDGPTMODELS", label: "Claude e GPT" },
  ] as const;
  const windows = groups.flatMap((group) => {
    const start = compact.lastIndexOf(group.heading);
    if (start < 0) return [];
    const end = group.end ? compact.indexOf(group.end, start + 1) : -1;
    const section = compact.slice(start, end < 0 ? undefined : end);
    const weekly = /WeeklyLimit.*?(\d{1,3}(?:\.\d+)?)%/iu.exec(section)?.[1];
    const rolling = /FiveHourLimit.*?(\d{1,3}(?:\.\d+)?)%/iu.exec(section)?.[1];
    return [
      quotaWindow({
        durationMinutes: 7 * 24 * 60,
        kind: "weekly",
        label: `Semanal · ${group.label}`,
        modelGroup: group.label,
        remaining: weekly,
      }),
      quotaWindow({
        durationMinutes: 5 * 60,
        kind: "rolling",
        label: `Sessão (5h) · ${group.label}`,
        modelGroup: group.label,
        remaining: rolling,
      }),
    ].filter((window) => window.remainingPercent !== null);
  });
  if (windows.length !== 4)
    throw new Error("AGY /quota sem os quatro limites legíveis");

  return {
    accountLabel: "Antigravity",
    accountRef: accountRef ?? "antigravity",
    collectedAt: options.collectedAt,
    credits: null,
    error: null,
    freshness: "live",
    plan: plan ? plan.replace(/AI/u, " AI ") : null,
    provider: "antigravity",
    runtime: "agy",
    source: {
      adapterVersion: `agy-quota-v${options.cliVersion}`,
      kind: UsageSourceKind.NativePresentational,
      method: "native /quota screen",
    },
    validUntil: new Date(
      Date.parse(options.collectedAt) + 10 * 60_000,
    ).toISOString(),
    windows,
  };
}

export class AgyUsageCollector {
  constructor(
    private readonly dependencies: {
      clock: () => Date;
      command?: string | null;
      readScreen?: () => Promise<AgyUsageResult>;
      ttlMs?: number;
    },
  ) {}

  async collect(options: {
    previous?: UsageSnapshot;
    reason: "overview" | "refresh";
  }): Promise<UsageSnapshot> {
    const now = this.dependencies.clock();
    if (
      options.reason === "overview" &&
      options.previous?.freshness === "live" &&
      now.getTime() - Date.parse(options.previous.collectedAt) <=
        (this.dependencies.ttlMs ?? 10 * 60_000)
    )
      return options.previous;
    const command =
      this.dependencies.command === undefined
        ? locateLocalBinary("agy")
        : this.dependencies.command;
    if (!command)
      return unavailable(now.toISOString(), "Antigravity CLI não encontrado.");
    try {
      const result = await (
        this.dependencies.readScreen ?? (() => runAgyUsageScreen({ command }))
      )();
      return parseAgyUsage(result.output, {
        cliVersion: result.cliVersion,
        collectedAt: now.toISOString(),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (options.previous)
        return {
          ...options.previous,
          error: detail,
          freshness: "stale",
          validUntil: now.toISOString(),
        };
      return unavailable(now.toISOString(), detail);
    }
  }
}

export function runAgyUsageScreen(
  options: {
    command?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    spawnPty?: SpawnUsagePty;
    timeoutMs?: number;
  } = {},
): Promise<AgyUsageResult> {
  return new Promise((resolve) => {
    const terminal = (options.spawnPty ?? nativeSpawnPty)(
      options.command ?? locateLocalBinary("agy") ?? "agy",
      [],
      {
        cols: 140,
        cwd: options.cwd ?? path.join(homedir(), "OkamiWorkspace"),
        env: options.env ?? process.env,
        name: "xterm-256color",
        // The quota view is 30 lines. Keeping it on one screen avoids a
        // second, scroll-dependent scrape of the presentational CLI.
        rows: 52,
      },
    );
    let output = "";
    let asked = false;
    let settled = false;
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
        // The native screen may have exited while its final redraw arrived.
      }
      const version =
        /AntigravityCLI([0-9][\w.-]+)/iu.exec(compactScreen(output))?.[1] ??
        "unknown";
      resolve({ cliVersion: version, exitCode, output });
    };

    terminal.onData((data) => {
      output += data;
      const compact = compactScreen(output);
      if (
        !trustHandled &&
        /trust(?:thecontentsofthisproject|thisfolder)/iu.test(compact)
      ) {
        trustHandled = true;
        terminal.write("\r");
        return;
      }
      if (!asked && /forshortcuts/iu.test(compact)) {
        asked = true;
        setTimeout(() => terminal.write("/quota\r"), 500);
      }
      if (
        asked &&
        /GEMINIMODELS.*FiveHourLimit.*CLAUDEANDGPTMODELS.*FiveHourLimit.*%/iu.test(
          compact,
        )
      ) {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(0), 1_200);
      }
    });
    terminal.onExit(({ exitCode }) => finish(exitCode));
  });
}

function quotaWindow(options: {
  durationMinutes: number;
  kind: string;
  label: string;
  modelGroup: string;
  remaining: string | undefined;
}) {
  const remaining =
    options.remaining === undefined
      ? null
      : Math.max(0, Math.min(100, Number(options.remaining)));
  return {
    durationMinutes: options.durationMinutes,
    kind: options.kind,
    label: options.label,
    modelGroup: options.modelGroup,
    remainingPercent: remaining,
    resetsAt: null,
    usedPercent: remaining === null ? null : 100 - remaining,
  };
}

function unavailable(collectedAt: string, error: string): UsageSnapshot {
  return {
    accountLabel: "Antigravity",
    accountRef: "antigravity",
    collectedAt,
    credits: null,
    error,
    freshness: "unavailable",
    plan: null,
    provider: "antigravity",
    runtime: "agy",
    source: {
      adapterVersion: "agy-quota-v1",
      kind: UsageSourceKind.Unavailable,
      method: "native /quota screen",
    },
    validUntil: null,
    windows: [],
  };
}
