import { describe, expect, it } from "vitest";
import { secureWebPreferences } from "./window";

describe("main window", () => {
  it("enforces the renderer security invariants", () => {
    expect(secureWebPreferences.contextIsolation).toBe(true);
    expect(secureWebPreferences.nodeIntegration).toBe(false);
    expect(secureWebPreferences.sandbox).toBe(true);
  });
});
