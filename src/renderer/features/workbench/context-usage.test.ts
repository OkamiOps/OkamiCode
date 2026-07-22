import { describe, expect, it } from "vitest";
import { describeSessionContext } from "./context-usage";

describe("describeSessionContext", () => {
  it("does not present aggregate Claude billing tokens as current context occupancy", () => {
    const context = describeSessionContext(
      {
        inputTokens: 12,
        cacheReadTokens: 820_000,
        outputTokens: 42_000,
        contextTokens: null,
        contextWindow: 1_000_000,
      },
      "claude-fable-5[1m]",
    );

    expect(context).toMatchObject({
      label: "janela indisponível",
      percent: null,
    });
    expect(context?.label).not.toContain("861k");
  });

  it("uses a dedicated current-context reading when the runtime reports one", () => {
    const context = describeSessionContext(
      {
        inputTokens: 12,
        cacheReadTokens: 820_000,
        outputTokens: 42_000,
        contextTokens: 48_000,
        contextWindow: 200_000,
      },
      "gpt-5.6-sol",
    );

    expect(context).toMatchObject({
      label: "48k/200k tokens",
      percent: 24,
    });
  });
});
