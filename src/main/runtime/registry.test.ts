import { expect, it } from "vitest";
import { AgyAdapter } from "./agy/adapter";
import { GrokAdapter } from "./grok/adapter";
import { createRuntimeRegistry } from "./registry";

it("registers the native Antigravity adapter", () => {
  const registry = createRuntimeRegistry({
    claude: {} as never,
    codex: {} as never,
    cursor: {} as never,
    agy: {} as never,
    grok: {} as never,
  });

  expect(registry.lookup("agy")).toBeInstanceOf(AgyAdapter);
  expect(registry.lookup("grok")).toBeInstanceOf(GrokAdapter);
});
