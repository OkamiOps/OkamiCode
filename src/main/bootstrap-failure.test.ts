import { describe, expect, it } from "vitest";
import { bootstrapFailurePage } from "./bootstrap-failure";

describe("bootstrapFailurePage", () => {
  it("shows an actionable local failure instead of loading a backend-less shell", () => {
    const page = bootstrapFailurePage({
      code: "ERR_DLOPEN_FAILED",
      development: true,
    });

    expect(page).toContain("OkamiCode não conseguiu iniciar");
    expect(page).toContain("pnpm rebuild:native");
    expect(page).toContain("ERR_DLOPEN_FAILED");
    expect(page).not.toContain("/Users/");
  });
});
