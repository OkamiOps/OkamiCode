import { describe, expect, it } from "vitest";
import type { LaneId, RunId } from "../../shared/ids";
import { ClaudeAdapter } from "./claude/adapter";
import { CodexAdapter } from "./codex/adapter";
import { CursorAdapter } from "./cursor/adapter";

const request = {
  runId: "11111111-1111-4111-8111-111111111111" as RunId,
  laneId: "22222222-2222-4222-8222-222222222222" as LaneId,
  nativeSessionId: null,
  input: "must not reach an existing adapter",
};

describe("existing runtime adapters", () => {
  it.each([
    ["Claude", new ClaudeAdapter({} as never)],
    ["Codex", new CodexAdapter({} as never)],
    ["Cursor", new CursorAdapter({} as never)],
  ])(
    "rejects a deferred native session before calling %s",
    async (_name, adapter) => {
      await expect(adapter.sendTurn(request)).rejects.toThrow(
        "authoritative native session id",
      );
    },
  );
});
