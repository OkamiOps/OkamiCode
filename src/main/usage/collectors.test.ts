import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../db/test-support";
import { UsageActivityService } from "./activity";
import {
  ClaudeUsageCollector,
  parseClaudeUsage,
  runClaudeUsageScreen,
} from "./claude-collector";
import { collectCodexUsage } from "./codex-collector";
import { UsageSnapshotRepository, withFreshness } from "./model";
import { PreflightService } from "./preflight";

function readFixture(name: string): string {
  return readFileSync(`tests/fixtures/usage/${name}`, "utf8");
}

describe("usage collectors", () => {
  it("never promotes stale presentational data to an official snapshot", () => {
    const parsed = parseClaudeUsage(readFixture("claude-usage.txt"), {
      cliVersion: "2.1.214",
      collectedAt: "2026-07-16T10:00:00.000Z",
    });

    expect(parsed.source.kind).toBe("native_presentational");
    // Real /usage screens report session, weekly and per-model windows.
    expect(
      parsed.windows.map((entry) => [entry.label, entry.usedPercent]),
    ).toEqual([
      ["Sessão (5h)", 29],
      ["Semanal", 53],
      ["Semanal · Fable", 91],
    ]);
    expect(parsed.sessionContext).toMatchObject({
      freshness: "live",
      usedPercent: 38,
      source: { kind: "native_presentational" },
    });
    const stale = withFreshness(parsed, {
      collectedAt: "2026-07-16T10:00:00.000Z",
      now: "2026-07-17T10:00:00.000Z",
    });
    expect(stale.freshness).toBe("stale");
    expect(stale.source.kind).not.toBe("official_structured");
  });

  it("reads Codex quota through structured account requests without sending a turn", async () => {
    const fixture = JSON.parse(readFixture("codex-rate-limits.json")) as Record<
      string,
      unknown
    >;
    const client = {
      readRateLimits: vi.fn(async () => ({ rateLimits: fixture.rateLimits })),
      readUsage: vi.fn(async () => fixture.usage as Record<string, unknown>),
      startTurn: vi.fn(),
    };

    const snapshot = await collectCodexUsage(client, {
      accountRef: "chatgpt-main",
      collectedAt: "2026-07-18T12:00:00.000Z",
    });

    expect(snapshot.source.kind).toBe("official_structured");
    expect(snapshot.windows.map((window) => window.remainingPercent)).toEqual([
      72, 54,
    ]);
    expect(client.readRateLimits).toHaveBeenCalledOnce();
    expect(client.readUsage).toHaveBeenCalledOnce();
    expect(client.startTurn).not.toHaveBeenCalled();
  });

  it("spawns the Claude usage screen only on refresh or TTL expiry", async () => {
    const spawnUsageScreen = vi.fn(async () => ({
      cliVersion: "2.1.214",
      exitCode: 0,
      output: readFixture("claude-usage.txt"),
    }));
    const collector = new ClaudeUsageCollector({
      clock: () => new Date("2026-07-18T12:05:00.000Z"),
      spawnUsageScreen,
      ttlMs: 10 * 60 * 1000,
    });
    const current = parseClaudeUsage(readFixture("claude-usage.txt"), {
      cliVersion: "2.1.214",
      collectedAt: "2026-07-18T12:00:00.000Z",
    });

    expect(
      await collector.collect({ previous: current, reason: "overview" }),
    ).toBe(current);
    expect(spawnUsageScreen).not.toHaveBeenCalled();
    await collector.collect({ previous: current, reason: "refresh" });
    expect(spawnUsageScreen).toHaveBeenCalledOnce();
  });

  it("preserves the prior Claude snapshot as stale on parser mismatch", async () => {
    const previous = parseClaudeUsage(readFixture("claude-usage.txt"), {
      cliVersion: "2.1.214",
      collectedAt: "2026-07-18T11:00:00.000Z",
    });
    const collector = new ClaudeUsageCollector({
      clock: () => new Date("2026-07-18T12:00:00.000Z"),
      spawnUsageScreen: async () => ({
        cliVersion: "2.2.0",
        exitCode: 0,
        output: "A redesigned usage screen",
      }),
    });

    const result = await collector.collect({ previous, reason: "refresh" });

    expect(result.windows).toEqual(previous.windows);
    expect(result.freshness).toBe("stale");
    expect(result.error).toMatch(/2\.2\.0|parser/i);
    expect(result.source.kind).toBe("native_presentational");
  });

  it("drives the native usage screen through a stub PTY command", async () => {
    const writes: string[] = [];
    let emitData: ((data: string) => void) | undefined;
    let emitExit:
      ((event: { exitCode: number; signal: number }) => void) | undefined;
    const spawnPty = vi.fn(() => ({
      kill: vi.fn(),
      onData(listener: (data: string) => void) {
        emitData = listener;
        // The real CLI paints a prompt before accepting a slash command;
        // the scraper waits for it instead of writing blindly.
        queueMicrotask(() => listener("⏸ manual mode on · ? for shortcuts"));
        return { dispose: vi.fn() };
      },
      onExit(listener: (event: { exitCode: number; signal: number }) => void) {
        emitExit = listener;
        return { dispose: vi.fn() };
      },
      write(value: string) {
        writes.push(value);
        queueMicrotask(() => {
          emitData?.(readFixture("claude-usage.txt"));
          emitExit?.({ exitCode: 0, signal: 0 });
        });
      },
    }));

    const result = await runClaudeUsageScreen({
      command: "claude-stub",
      spawnPty,
      timeoutMs: 4_000,
    });

    expect(spawnPty).toHaveBeenCalledWith(
      "claude-stub",
      [],
      expect.objectContaining({ name: "xterm-256color" }),
    );
    expect(writes).toEqual(["/usage\r"]);
    expect(result.cliVersion).toBe("2.1.214");
  });
});

describe("local activity", () => {
  it("rebuilds usage buckets from persisted usage events without quota percentages", () => {
    const fixture = createTestDatabase();
    fixture.events.append(
      fixture.event({
        kind: "usage_reported",
        occurredAt: "2026-07-18T09:42:00.000Z",
        payload: {
          usage: {
            input_tokens: 120,
            cache_read_input_tokens: 30,
            output_tokens: 50,
          },
          model: "claude-sonnet-4-6",
        },
      }),
    );
    const activity = new UsageActivityService(fixture.db);

    activity.rebuild();
    activity.rebuild();
    const buckets = activity.readBuckets();

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 30,
      outputTokens: 50,
      messages: 0,
      runtime: "claude",
    });
    expect(Object.keys(buckets[0] ?? {})).not.toEqual(
      expect.arrayContaining(["usedPercent", "remainingPercent"]),
    );
  });
});

describe("usage snapshots", () => {
  it("does not duplicate windows when a fresh TTL snapshot is reused", () => {
    const fixture = createTestDatabase();
    let id = 0;
    const repository = new UsageSnapshotRepository(
      fixture.db,
      () => `usage-id-${++id}`,
    );
    const snapshot = parseClaudeUsage(readFixture("claude-usage.txt"), {
      cliVersion: "2.1.214",
      collectedAt: "2026-07-18T12:00:00.000Z",
    });

    repository.save(snapshot);
    repository.save(snapshot);

    expect(repository.readLatest()[0]?.windows).toHaveLength(3);
  });
});

describe("preflight", () => {
  it("ranks compatible healthy lanes and warns without automatic switching", () => {
    const result = new PreflightService().evaluate({
      hardStop: false,
      lanes: [
        {
          accountRef: "claude-main",
          capabilities: ["tools"],
          health: "ready",
          laneId: "claude-lane",
        },
        {
          accountRef: "chatgpt-main",
          capabilities: ["tools", "vision"],
          health: "ready",
          laneId: "codex-lane",
        },
      ],
      requiredCapabilities: ["tools"],
      snapshots: [
        {
          accountRef: "claude-main",
          freshness: "stale",
          remainingPercent: 40,
        },
        {
          accountRef: "chatgpt-main",
          freshness: "live",
          remainingPercent: 8,
        },
      ],
    });

    expect(result.automaticSwitch).toBeNull();
    expect(result.decision).toBe("warning");
    expect(result.suggestions.map((suggestion) => suggestion.laneId)).toEqual([
      "codex-lane",
      "claude-lane",
    ]);
    expect(result.warnings.join(" ")).toMatch(/baixa|stale/i);
  });

  it("blocks only an explicit hard_stop policy", () => {
    const result = new PreflightService().evaluate({
      hardStop: true,
      lanes: [],
      requiredCapabilities: [],
      snapshots: [],
    });

    expect(result.decision).toBe("blocked");
    expect(result.automaticSwitch).toBeNull();
  });

  it("warns when a compatible lane has no quota snapshot", () => {
    const result = new PreflightService().evaluate({
      hardStop: false,
      lanes: [
        {
          accountRef: "chatgpt-main",
          capabilities: ["tools"],
          health: "ready",
          laneId: "codex-lane",
        },
      ],
      requiredCapabilities: ["tools"],
      snapshots: [],
    });

    expect(result.decision).toBe("warning");
    expect(result.warnings.join(" ")).toMatch(/indisponível/i);
    expect(result.automaticSwitch).toBeNull();
  });
});
