import { describe, expect, it } from "vitest";
import { AgyUsageCollector } from "./agy-collector";
import { ClaudeUsageCollector } from "./claude-collector";
import { CodexUsageCollector } from "./codex-collector";
import { CursorUsageCollector } from "./cursor-collector";
import { GrokUsageCollector } from "./grok-collector";
import { MiniMaxUsageCollector } from "./minimax-collector";

const runLive = process.env.OKAMI_LIVE_USAGE === "1";

describe.runIf(runLive)("installed usage CLIs", () => {
  it("reads subscription limits without sending a model turn", async () => {
    const clock = () => new Date();
    const snapshots = [];
    snapshots.push(
      await new CodexUsageCollector({ clock }).collect({ reason: "refresh" }),
    );
    snapshots.push(
      await new ClaudeUsageCollector({ clock }).collect({ reason: "refresh" }),
    );
    snapshots.push(
      await new AgyUsageCollector({ clock }).collect({ reason: "refresh" }),
    );
    snapshots.push(
      await new CursorUsageCollector({ clock }).collect({ reason: "refresh" }),
    );
    snapshots.push(
      await new GrokUsageCollector({ clock }).collect({ reason: "refresh" }),
    );
    snapshots.push(await new MiniMaxUsageCollector({ clock }).collect());

    process.stdout.write(
      `${JSON.stringify(
        snapshots.map(({ provider, freshness, error, windows }) => ({
          provider,
          freshness,
          error,
          windows: windows.map(
            ({ label, usedPercent, remainingPercent, resetsAt }) => ({
              label,
              usedPercent,
              remainingPercent,
              resetsAt,
            }),
          ),
        })),
        null,
        2,
      )}\n`,
    );

    expect(
      snapshots.map((snapshot) => ({
        provider: snapshot.provider,
        freshness: snapshot.freshness,
        hasWindows: snapshot.windows.length > 0,
      })),
    ).toEqual(
      expect.arrayContaining(
        [
          "chatgpt",
          "claude_max",
          "antigravity",
          "cursor",
          "grok",
          "minimax",
        ].map((provider) => ({
          provider,
          freshness: "live",
          hasWindows: true,
        })),
      ),
    );
  }, 180_000);
});
