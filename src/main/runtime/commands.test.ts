import { expect, it, vi } from "vitest";
import { resolveRuntimeCommands } from "./commands";

it("resolves absolute launch commands for every CLI-backed runtime", () => {
  const locate = vi.fn((client: string) => `/resolved/${client}`);

  expect(resolveRuntimeCommands(locate)).toMatchObject({
    claude: "/resolved/claude",
    cursor: "/resolved/cursor",
    minimax: "/resolved/minimax",
  });
});
