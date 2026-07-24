import { UsageSourceKind, withFreshness, type UsageSnapshot } from "./model";
import { compactScreen, runNativeUsageScreen } from "./native-usage-screen";

interface CursorUsageResult {
  cliVersion: string;
  exitCode: number;
  output: string;
}

export function parseCursorUsage(
  raw: string,
  options: { cliVersion: string; collectedAt: string },
): UsageSnapshot {
  const compact = compactScreen(raw);
  const plan =
    /Usage[•·]([A-Za-z0-9+_-]+?)(?:Resets|Monthly)/u.exec(compact)?.[1] ?? null;
  const resetLabel = /Resets([A-Za-z]{3,9}\d{1,2})/u.exec(compact)?.[1];
  const resetsAt = parseMonthDay(resetLabel, options.collectedAt);
  const categories = [
    { key: "Included", label: "Mensal · Incluído", modelGroup: null },
    { key: "Auto", label: "Mensal · Auto", modelGroup: "Auto" },
    { key: "API", label: "Mensal · API", modelGroup: "API" },
  ] as const;
  const windows = categories.flatMap((category) => {
    const match = new RegExp(`${category.key}(\\d{1,3})%used`, "u").exec(
      compact,
    );
    if (!match) return [];
    const used = clamp(Number(match[1]));
    return [
      {
        durationMinutes: 30 * 24 * 60,
        kind: "monthly",
        label: category.label,
        modelGroup: category.modelGroup,
        remainingPercent: 100 - used,
        resetsAt,
        usedPercent: used,
      },
    ];
  });
  if (windows.length === 0)
    throw new Error("Cursor /usage sem limites legíveis");
  return {
    accountLabel: "Cursor",
    accountRef: "cursor",
    collectedAt: options.collectedAt,
    credits: null,
    error: null,
    freshness: "live",
    plan,
    provider: "cursor",
    runtime: "cursor",
    source: {
      adapterVersion: `cursor-usage-v${options.cliVersion}`,
      kind: UsageSourceKind.NativePresentational,
      method: "native /usage screen",
    },
    validUntil: new Date(
      Date.parse(options.collectedAt) + 10 * 60_000,
    ).toISOString(),
    windows,
  };
}

export class CursorUsageCollector {
  constructor(
    private readonly dependencies: {
      clock: () => Date;
      command?: string | null;
      readScreen?: () => Promise<CursorUsageResult>;
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
    ) {
      return options.previous;
    }
    const command = this.dependencies.command ?? null;
    if (!command)
      return unavailable(now.toISOString(), "Cursor CLI não encontrado.");
    try {
      const result = await (
        this.dependencies.readScreen ?? (() => readCursorScreen(command))
      )();
      return parseCursorUsage(result.output, {
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

async function readCursorScreen(command: string): Promise<CursorUsageResult> {
  const result = await runNativeUsageScreen({
    args: ["--trust"],
    command,
    completion: /On-Demand(?:Disabled|usageisoff)/iu,
    // The banner arrives before the input is ready. Waiting for the actual
    // prompt avoids losing /usage during Cursor's startup redraw.
    ready: /Plan,?search,?buildanything/iu,
    slashCommand: "/usage",
    submitCount: 2,
  });
  const version =
    /CursorAgent(?:CLI)?v?([0-9][\w.-]+)/iu.exec(
      compactScreen(result.output),
    )?.[1] ?? "unknown";
  return { ...result, cliVersion: version };
}

function parseMonthDay(
  value: string | undefined,
  collectedAt: string,
): string | null {
  if (!value) return null;
  const match = /^([A-Za-z]{3,9})(\d{1,2})$/u.exec(value);
  if (!match) return null;
  const base = new Date(collectedAt);
  const month = new Date(`${match[1]} 1, 2000`).getMonth();
  if (Number.isNaN(month)) return null;
  const result = new Date(
    Date.UTC(base.getUTCFullYear(), month, Number(match[2])),
  );
  if (result.getTime() < base.getTime())
    result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result.toISOString();
}

function unavailable(collectedAt: string, error: string): UsageSnapshot {
  return {
    accountLabel: "Cursor",
    accountRef: "cursor",
    collectedAt,
    credits: null,
    error,
    freshness: "unavailable",
    plan: null,
    provider: "cursor",
    runtime: "cursor",
    source: {
      adapterVersion: "cursor-usage-v1",
      kind: UsageSourceKind.Unavailable,
      method: "native /usage screen",
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
