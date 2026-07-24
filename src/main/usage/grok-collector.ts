import { UsageSourceKind, withFreshness, type UsageSnapshot } from "./model";
import { compactScreen, runNativeUsageScreen } from "./native-usage-screen";

interface GrokUsageResult {
  cliVersion: string;
  exitCode: number;
  output: string;
}

export function parseGrokUsage(
  raw: string,
  options: { cliVersion: string; collectedAt: string },
): UsageSnapshot {
  const compact = compactScreen(raw);
  const usedMatch = /Weeklylimit:(\d{1,3})%/iu.exec(compact);
  if (!usedMatch)
    throw new Error("Grok /usage show sem limite semanal legível");
  const used = clamp(Number(usedMatch[1]));
  const reset = /Nextreset:([A-Za-z]+)(\d{1,2}),(\d{1,2}):(\d{2})/iu.exec(
    compact,
  );
  return {
    accountLabel: "Grok",
    accountRef: "grok",
    collectedAt: options.collectedAt,
    credits: null,
    error: null,
    freshness: "live",
    plan: null,
    provider: "grok",
    runtime: "grok",
    source: {
      adapterVersion: `grok-usage-v${options.cliVersion}`,
      kind: UsageSourceKind.NativePresentational,
      method: "native /usage show screen",
    },
    validUntil: new Date(
      Date.parse(options.collectedAt) + 10 * 60_000,
    ).toISOString(),
    windows: [
      {
        durationMinutes: 7 * 24 * 60,
        kind: "weekly",
        label: "Semanal",
        modelGroup: null,
        remainingPercent: 100 - used,
        resetsAt: parseReset(reset, options.collectedAt),
        usedPercent: used,
      },
    ],
  };
}

export class GrokUsageCollector {
  constructor(
    private readonly dependencies: {
      clock: () => Date;
      command?: string | null;
      readScreen?: () => Promise<GrokUsageResult>;
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
      options.previous &&
      options.previous.freshness === "live" &&
      now.getTime() - Date.parse(options.previous.collectedAt) <=
        (this.dependencies.ttlMs ?? 10 * 60_000)
    )
      return options.previous;
    const command = this.dependencies.command ?? null;
    if (!command)
      return unavailable(now.toISOString(), "Grok CLI não encontrado.");
    try {
      const result = await (
        this.dependencies.readScreen ?? (() => readGrokScreen(command))
      )();
      return parseGrokUsage(result.output, {
        cliVersion: result.cliVersion,
        collectedAt: now.toISOString(),
      });
    } catch (error) {
      if (options.previous) {
        return {
          ...withFreshness(options.previous, {
            now: now.toISOString(),
            staleAfterMs: 0,
          }),
          error: message(error),
          freshness: "stale",
        };
      }
      return unavailable(now.toISOString(), message(error));
    }
  }
}

async function readGrokScreen(command: string): Promise<GrokUsageResult> {
  const result = await runNativeUsageScreen({
    args: ["--no-alt-screen"],
    command,
    completion: /Weeklylimit:.*Nextreset:/iu,
    ready: /GrokBuild/iu,
    slashCommand: "/usage show",
  });
  const version =
    /GrokBuild([0-9][\w.-]+)/iu.exec(compactScreen(result.output))?.[1] ??
    "unknown";
  return { ...result, cliVersion: version };
}

function parseReset(
  match: RegExpExecArray | null,
  collectedAt: string,
): string | null {
  if (!match) return null;
  const base = new Date(collectedAt);
  const month = new Date(`${match[1]} 1, 2000`).getMonth();
  if (Number.isNaN(month)) return null;
  const result = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      month,
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
    ),
  );
  if (result.getTime() < base.getTime())
    result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result.toISOString();
}

function unavailable(collectedAt: string, error: string): UsageSnapshot {
  return {
    accountLabel: "Grok",
    accountRef: "grok",
    collectedAt,
    credits: null,
    error,
    freshness: "unavailable",
    plan: null,
    provider: "grok",
    runtime: "grok",
    source: {
      adapterVersion: "grok-usage-v1",
      kind: UsageSourceKind.Unavailable,
      method: "native /usage show screen",
    },
    validUntil: null,
    windows: [],
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
