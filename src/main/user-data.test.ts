import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUserDataPath } from "./user-data";

describe("resolveUserDataPath", () => {
  it("keeps explicit isolated-profile overrides", () => {
    expect(
      resolveUserDataPath({
        appDataPath: "/Users/test/Library/Application Support",
        currentUserDataPath:
          "/Users/test/Library/Application Support/okami-code",
        override: "/tmp/okami-e2e",
        pathExists: () => true,
      }),
    ).toBe("/tmp/okami-e2e");
  });

  it("reuses the legacy workbench profile when its database exists", () => {
    const appDataPath = "/Users/test/Library/Application Support";
    const legacyPath = path.join(appDataPath, "okami-workbench");

    expect(
      resolveUserDataPath({
        appDataPath,
        currentUserDataPath: path.join(appDataPath, "okami-code"),
        pathExists: (candidate) =>
          candidate === path.join(legacyPath, "workbench.db"),
      }),
    ).toBe(legacyPath);
  });

  it("keeps the current profile for a fresh installation", () => {
    const currentUserDataPath =
      "/Users/test/Library/Application Support/okami-code";

    expect(
      resolveUserDataPath({
        appDataPath: "/Users/test/Library/Application Support",
        currentUserDataPath,
        pathExists: () => false,
      }),
    ).toBe(currentUserDataPath);
  });
});
