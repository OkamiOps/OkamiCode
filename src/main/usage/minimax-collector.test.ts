import { expect, it, vi } from "vitest";
import { MiniMaxUsageCollector } from "./minimax-collector";

it("maps mmx quota JSON to honest five-hour and weekly windows", async () => {
  const collector = new MiniMaxUsageCollector({
    clock: () => new Date("2026-07-22T01:00:00.000Z"),
    command: "/real/mmx",
    execute: vi.fn(async () =>
      JSON.stringify({
        model_remains: [
          {
            model_name: "general",
            end_time: 1784696400000,
            weekly_end_time: 1785110400000,
            current_interval_remaining_percent: 82,
            current_weekly_remaining_percent: 64,
          },
        ],
      }),
    ),
  });

  const snapshot = await collector.collect();

  expect(snapshot).toMatchObject({
    provider: "minimax",
    runtime: "minimax",
    freshness: "live",
    windows: [
      { kind: "rolling", remainingPercent: 82, usedPercent: 18 },
      { kind: "weekly", remainingPercent: 64, usedPercent: 36 },
    ],
  });
});
