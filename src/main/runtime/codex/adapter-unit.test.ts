import { expect, it } from "vitest";
import { CodexRpcError } from "./client";
import { isMissingCodexRollout } from "./adapter";

it("classifies only the missing-rollout resume failure as lost continuation", () => {
  expect(
    isMissingCodexRollout(
      new CodexRpcError(
        "no rollout found for thread id 276bfeed-6f41-4baf-b2db",
      ),
    ),
  ).toBe(true);
  expect(
    isMissingCodexRollout(new CodexRpcError("authentication required")),
  ).toBe(false);
  expect(isMissingCodexRollout(new Error("no rollout found"))).toBe(false);
});
