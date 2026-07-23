import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../db/test-support";
import { UsageActivityService } from "./activity";
import {
  ClaudeUsageCollector,
  parseClaudeUsage,
  runClaudeUsageScreen,
} from "./claude-collector";
import { collectCodexUsage } from "./codex-collector";
import {
  AgyUsageCollector,
  parseAgyUsage,
  runAgyUsageScreen,
} from "./agy-collector";
import { parseCursorUsage } from "./cursor-collector";
import { parseGrokUsage } from "./grok-collector";
import { runNativeUsageScreen } from "./native-usage-screen";
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

    await collector.collect({
      previous: { ...current, freshness: "stale" },
      reason: "overview",
    });
    expect(spawnUsageScreen).toHaveBeenCalledTimes(2);
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

  it("resolves the installed Claude binary instead of relying on Finder PATH", async () => {
    let emitData: ((data: string) => void) | undefined;
    const spawnPty = vi.fn(() => ({
      kill: vi.fn(),
      onData(listener: (data: string) => void) {
        emitData = listener;
        queueMicrotask(() => listener("manual mode on · ? for shortcuts"));
        return { dispose: vi.fn() };
      },
      onExit() {
        return { dispose: vi.fn() };
      },
      write() {
        queueMicrotask(() => emitData?.(readFixture("claude-usage.txt")));
      },
    }));

    await runClaudeUsageScreen({
      locateCommand: () => "/Users/test/.local/bin/claude",
      spawnPty,
      timeoutMs: 4_000,
    });

    expect(spawnPty).toHaveBeenCalledWith(
      "/Users/test/.local/bin/claude",
      [],
      expect.objectContaining({ cwd: path.join(homedir(), "OkamiWorkspace") }),
    );
  });

  it("confirms trust for the app-owned OkamiWorkspace before asking for usage", async () => {
    const writes: string[] = [];
    let emitData: ((data: string) => void) | undefined;
    const spawnPty = vi.fn(() => ({
      kill: vi.fn(),
      onData(listener: (data: string) => void) {
        emitData = listener;
        queueMicrotask(() => listener("1. Yes, I trust this folder"));
        return { dispose: vi.fn() };
      },
      onExit() {
        return { dispose: vi.fn() };
      },
      write(value: string) {
        writes.push(value);
        if (writes.length === 1) {
          queueMicrotask(() => emitData?.("manual mode on · ? for shortcuts"));
        } else {
          queueMicrotask(() => emitData?.(readFixture("claude-usage.txt")));
        }
      },
    }));

    await runClaudeUsageScreen({ spawnPty, timeoutMs: 4_000 });

    expect(writes).toEqual(["\r", "/usage\r"]);
  });

  it("parses current Cursor plan categories from its native usage screen", () => {
    const snapshot = parseCursorUsage(readFixture("cursor-usage.txt"), {
      cliVersion: "2026.07.17-3e2a980",
      collectedAt: "2026-07-22T10:00:00.000Z",
    });

    expect(snapshot.plan).toBe("Pro");
    expect(snapshot.windows).toEqual([
      expect.objectContaining({
        label: "Mensal · Incluído",
        modelGroup: null,
        remainingPercent: 58,
        usedPercent: 42,
      }),
      expect.objectContaining({
        label: "Mensal · Auto",
        modelGroup: "Auto",
        remainingPercent: 67,
        usedPercent: 33,
      }),
      expect.objectContaining({
        label: "Mensal · API",
        modelGroup: "API",
        remainingPercent: 0,
        usedPercent: 100,
      }),
    ]);
  });

  it("parses the Grok weekly limit without sending a model turn", () => {
    const snapshot = parseGrokUsage(readFixture("grok-usage.txt"), {
      cliVersion: "0.2.106",
      collectedAt: "2026-07-22T10:00:00.000Z",
    });

    expect(snapshot.windows).toEqual([
      expect.objectContaining({
        kind: "weekly",
        remainingPercent: 100,
        usedPercent: 0,
      }),
    ]);
    expect(snapshot.windows[0]?.resetsAt).toMatch(/^2026-07-28T/);
  });

  it("parses all Antigravity quota groups as remaining capacity", () => {
    const snapshot = parseAgyUsage(readFixture("agy-quota.txt"), {
      cliVersion: "1.1.5",
      collectedAt: "2026-07-22T11:15:00.000Z",
    });

    expect(snapshot.accountRef).toBe("msant262@gmail.com");
    expect(snapshot.plan).toBe("Google AI Pro");
    expect(snapshot.windows).toEqual([
      expect.objectContaining({
        kind: "weekly",
        label: "Semanal · Gemini",
        modelGroup: "Gemini",
        remainingPercent: 100,
        usedPercent: 0,
      }),
      expect.objectContaining({
        kind: "rolling",
        label: "Sessão (5h) · Gemini",
        modelGroup: "Gemini",
        remainingPercent: 100,
        usedPercent: 0,
      }),
      expect.objectContaining({
        kind: "weekly",
        label: "Semanal · Claude e GPT",
        modelGroup: "Claude e GPT",
        remainingPercent: 100,
        usedPercent: 0,
      }),
      expect.objectContaining({
        kind: "rolling",
        label: "Sessão (5h) · Claude e GPT",
        modelGroup: "Claude e GPT",
        remainingPercent: 100,
        usedPercent: 0,
      }),
    ]);
  });

  it("reuses fresh Antigravity quota and refreshes it on demand", async () => {
    const previous = parseAgyUsage(readFixture("agy-quota.txt"), {
      cliVersion: "1.1.5",
      collectedAt: "2026-07-22T11:10:00.000Z",
    });
    const readScreen = vi.fn(async () => ({
      cliVersion: "1.1.5",
      exitCode: 0,
      output: readFixture("agy-quota.txt"),
    }));
    const collector = new AgyUsageCollector({
      clock: () => new Date("2026-07-22T11:15:00.000Z"),
      readScreen,
    });

    expect(await collector.collect({ previous, reason: "overview" })).toBe(
      previous,
    );
    expect(readScreen).not.toHaveBeenCalled();
    await collector.collect({ previous, reason: "refresh" });
    expect(readScreen).toHaveBeenCalledOnce();
  });

  it("confirms the app workspace before opening Antigravity quota", async () => {
    vi.useFakeTimers();
    try {
      const writes: string[] = [];
      let emitData: ((data: string) => void) | undefined;
      const resultPromise = runAgyUsageScreen({
        command: "agy-stub",
        spawnPty: () => ({
          kill: vi.fn(),
          onData(listener) {
            emitData = listener;
            queueMicrotask(() => listener("Yes, I trust this folder"));
            return { dispose: vi.fn() };
          },
          onExit() {
            return { dispose: vi.fn() };
          },
          write(value) {
            writes.push(value);
            if (writes.length === 1)
              queueMicrotask(() => emitData?.("? for shortcuts"));
            if (writes.length === 2)
              queueMicrotask(() => emitData?.(readFixture("agy-quota.txt")));
          },
        }),
        timeoutMs: 4_000,
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      expect(writes).toEqual(["\r", "/quota\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirms Cursor slash completion before waiting for usage data", async () => {
    vi.useFakeTimers();
    try {
      const writes: string[] = [];
      let emitData: ((data: string) => void) | undefined;
      const resultPromise = runNativeUsageScreen({
        command: "cursor-stub",
        completion: /On-DemandDisabled/u,
        ready: /Plan,search,buildanything/u,
        slashCommand: "/usage",
        submitCount: 2,
        spawnPty: () => ({
          kill: vi.fn(),
          onData(listener) {
            emitData = listener;
            queueMicrotask(() => listener("Plan, search, build anything"));
            return { dispose: vi.fn() };
          },
          onExit() {
            return { dispose: vi.fn() };
          },
          write(value) {
            writes.push(value);
            if (writes.length === 2) emitData?.("On-Demand Disabled");
          },
        }),
      });

      await vi.runAllTimersAsync();
      await resultPromise;

      expect(writes).toEqual(["/usage\r", "\r"]);
    } finally {
      vi.useRealTimers();
    }
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
            observed_total_tokens: 200,
            input_token_semantics: "excludes_cache_read",
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

  it("uses Claude modelUsage for identity without double-counting its token totals", () => {
    const fixture = createTestDatabase();
    fixture.events.append(
      fixture.event({
        kind: "usage_reported",
        occurredAt: "2026-07-18T09:42:00.000Z",
        payload: {
          runtime: "claude",
          usage: {
            input_tokens: 999,
            cache_read_input_tokens: 90,
            cache_creation_input_tokens: 9,
            output_tokens: 99,
            observed_total_tokens: 1_197,
            input_token_semantics: "excludes_cache_read",
          },
          modelUsage: {
            "claude-sonnet-4-6": {
              inputTokens: 120,
              cacheReadInputTokens: 30,
              cacheCreationInputTokens: 10,
              outputTokens: 50,
            },
          },
        },
      }),
    );
    const activity = new UsageActivityService(fixture.db);

    activity.rebuild();
    const buckets = activity.readBuckets();

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      model: "claude-sonnet-4-6",
      inputTokens: 999,
      cachedInputTokens: 99,
      outputTokens: 99,
    });
  });

  it("recovers the native model from the Claude session event", () => {
    const fixture = createTestDatabase();
    fixture.events.append(
      fixture.event({
        sequence: 0,
        kind: "session_started",
        payload: { runtime: "claude", model: "claude-opus-4-8" },
      }),
    );
    fixture.events.append(
      fixture.event({
        sequence: 1,
        kind: "usage_reported",
        payload: {
          runtime: "claude",
          usage: {
            input_tokens: 500,
            output_tokens: 50,
            observed_total_tokens: 550,
            input_token_semantics: "excludes_cache_read",
          },
          modelUsage: {},
        },
      }),
    );
    const activity = new UsageActivityService(fixture.db);

    activity.rebuild();

    expect(activity.readBuckets()[0]).toMatchObject({
      model: "claude-opus-4-8",
      inputTokens: 500,
      outputTokens: 50,
    });
  });

  it("restores provider-authored historical usage recorded before canonical markers", () => {
    const fixture = createTestDatabase();
    fixture.events.append(
      fixture.event({
        kind: "usage_reported",
        occurredAt: "2026-07-18T09:42:00.000Z",
        payload: {
          runtime: "claude",
          usage: {
            input_tokens: 44,
            cache_read_input_tokens: 4_080_093,
            output_tokens: 13_798,
          },
          modelUsage: {
            "claude-opus-4-8": {
              inputTokens: 44,
              cacheReadInputTokens: 4_080_093,
              outputTokens: 13_798,
            },
          },
        },
      }),
    );
    const activity = new UsageActivityService(fixture.db);

    activity.rebuild();

    expect(activity.readBuckets()[0]).toMatchObject({
      model: "claude-opus-4-8",
      inputTokens: 44,
      cachedInputTokens: 4_080_093,
      outputTokens: 13_798,
    });
  });

  it("restores historical ChatGPT usage emitted through the Claude harness", () => {
    const fixture = createTestDatabase();
    fixture.events.append(
      fixture.event({
        kind: "usage_reported",
        payload: {
          runtime: "claude",
          usage: {
            input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 10,
          },
          modelUsage: {
            "gpt-5.6-luna": {
              inputTokens: 0,
              cacheReadInputTokens: 0,
              outputTokens: 24,
            },
          },
        },
      }),
    );
    const activity = new UsageActivityService(fixture.db);

    activity.rebuild();

    expect(activity.readBuckets()[0]).toMatchObject({
      model: "gpt-5.6-luna",
      outputTokens: 10,
    });
  });

  it("excludes legacy usage records from cost-comparison buckets", () => {
    const fixture = createTestDatabase();
    fixture.events.append(
      fixture.event({
        kind: "usage_reported",
        payload: {
          usage: {
            input_tokens: 37_000_000,
            output_tokens: 10,
          },
        },
      }),
    );
    const activity = new UsageActivityService(fixture.db);

    activity.rebuild();

    expect(activity.readBuckets()).toEqual([]);
  });

  it("keeps completed Antigravity work visible with an explicit local estimate", () => {
    const fixture = createTestDatabase();
    fixture.db
      .prepare(
        "UPDATE runtime_lanes SET runtime_kind = 'agy', provider_kind = 'antigravity', model = 'gemini-3.6-flash-low'",
      )
      .run();
    fixture.events.append(
      fixture.event({
        kind: "message_completed",
        occurredAt: "2026-07-18T09:42:00.000Z",
        payload: { text: "Resposta concluída pelo Antigravity." },
      }),
    );
    const activity = new UsageActivityService(fixture.db);

    const bucket = activity.readBuckets()[0];

    expect(bucket).toMatchObject({
      runtime: "agy",
      model: "gemini-3.6-flash-low",
      inputTokens: 0,
      messages: 1,
      modelCalls: 1,
    });
    expect(bucket?.outputTokens).toBeGreaterThan(0);
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
