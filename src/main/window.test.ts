import { describe, expect, it, vi } from "vitest";
import { configureExternalNavigation, secureWebPreferences } from "./window";

describe("main window", () => {
  it("enforces the renderer security invariants", () => {
    expect(secureWebPreferences.contextIsolation).toBe(true);
    expect(secureWebPreferences.nodeIntegration).toBe(false);
    expect(secureWebPreferences.sandbox).toBe(true);
  });

  it("opens only trusted web links in the system browser and denies child windows", async () => {
    let handler:
      ((details: { url: string }) => { action: "deny" | "allow" }) | undefined;
    const openExternal = vi.fn().mockResolvedValue(undefined);

    configureExternalNavigation(
      {
        setWindowOpenHandler: (next) => {
          handler = next;
        },
      },
      openExternal,
    );

    expect(handler?.({ url: "https://meet.google.com/abc-defg-hij" })).toEqual({
      action: "deny",
    });
    await vi.waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith(
        "https://meet.google.com/abc-defg-hij",
      ),
    );

    expect(handler?.({ url: "javascript:alert(1)" })).toEqual({
      action: "deny",
    });
    expect(handler?.({ url: "file:///Users/marcos/.ssh/id_rsa" })).toEqual({
      action: "deny",
    });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
