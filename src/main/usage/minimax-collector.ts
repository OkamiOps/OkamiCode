import { execFile } from "node:child_process";
import { locateLocalBinary } from "../ecosystem/cli-capabilities";
import { UsageSourceKind, type UsageSnapshot } from "./model";

interface MiniMaxQuota {
  model_remains?: Array<{
    model_name?: unknown;
    end_time?: unknown;
    weekly_end_time?: unknown;
    current_interval_remaining_percent?: unknown;
    current_weekly_remaining_percent?: unknown;
  }>;
}

export class MiniMaxUsageCollector {
  constructor(
    private readonly dependencies: {
      clock: () => Date;
      command?: string | null;
      execute?: (command: string, args: string[]) => Promise<string>;
    },
  ) {}

  async collect(): Promise<UsageSnapshot> {
    const collectedAt = this.dependencies.clock().toISOString();
    const command =
      this.dependencies.command === undefined
        ? locateLocalBinary("minimax")
        : this.dependencies.command;
    if (!command)
      return unavailable(collectedAt, "MiniMax mmx não encontrado.");
    try {
      const output = await (this.dependencies.execute ?? execute)(command, [
        "quota",
        "show",
        "--output",
        "json",
        "--no-color",
        "--non-interactive",
      ]);
      const payload = JSON.parse(output) as MiniMaxQuota;
      const general = payload.model_remains?.find(
        (entry) => entry.model_name === "general",
      );
      if (!general) {
        return unavailable(collectedAt, "O mmx não retornou a quota geral.");
      }
      const interval = percent(general.current_interval_remaining_percent);
      const weekly = percent(general.current_weekly_remaining_percent);
      return {
        accountLabel: "MiniMax",
        accountRef: "minimax",
        collectedAt,
        credits: null,
        error: null,
        freshness: "live",
        plan: "Token Plan",
        provider: "minimax",
        runtime: "minimax",
        source: {
          adapterVersion: "mmx-quota-v1",
          kind: UsageSourceKind.OfficialStructured,
          method: "mmx quota show --output json",
        },
        validUntil: new Date(
          Date.parse(collectedAt) + 5 * 60_000,
        ).toISOString(),
        windows: [
          {
            durationMinutes: 300,
            kind: "rolling",
            label: "Janela atual",
            modelGroup: "general",
            remainingPercent: interval,
            resetsAt: timestamp(general.end_time),
            usedPercent: interval === null ? null : 100 - interval,
          },
          {
            durationMinutes: 7 * 24 * 60,
            kind: "weekly",
            label: "Semanal",
            modelGroup: "general",
            remainingPercent: weekly,
            resetsAt: timestamp(general.weekly_end_time),
            usedPercent: weekly === null ? null : 100 - weekly,
          },
        ],
      };
    } catch {
      return unavailable(
        collectedAt,
        "Não foi possível ler a quota do MiniMax.",
      );
    }
  }
}

function percent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function unavailable(collectedAt: string, error: string): UsageSnapshot {
  return {
    accountLabel: "MiniMax",
    accountRef: "minimax",
    collectedAt,
    credits: null,
    error,
    freshness: "unavailable",
    plan: null,
    provider: "minimax",
    runtime: "minimax",
    source: {
      adapterVersion: "mmx-quota-v1",
      kind: UsageSourceKind.Unavailable,
      method: "mmx quota show --output json",
    },
    validUntil: null,
    windows: [],
  };
}

function execute(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}
