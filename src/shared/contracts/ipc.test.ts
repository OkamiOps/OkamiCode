import { expect, it } from "vitest";
import { cliCapabilitySchema } from "./ipc";

const cursor = {
  client: "cursor",
  label: "Cursor",
  binaryPath: "/bin/cursor",
  version: "Cursor 1.0.0",
  role: "launcher",
  integrationStatus: "needs_adapter",
  detail: "CLI encontrado; a integração de runtime ainda não existe.",
  capabilities: ["launcher", "mcp"],
};

it("accepts the allowed Cursor launcher capability record", () => {
  expect(cliCapabilitySchema.safeParse(cursor).success).toBe(true);
});

it("rejects invalid roles, statuses, capability sets, and unavailable invariants per client", () => {
  const invalid = [
    {
      ...cursor,
      role: "runtime",
      integrationStatus: "ready",
    },
    {
      ...cursor,
      capabilities: ["launcher", "mcp", "app_server"],
    },
    {
      ...cursor,
      integrationStatus: "unavailable",
      binaryPath: "/bin/cursor",
      version: "Cursor 1.0.0",
      capabilities: ["launcher", "mcp"],
    },
  ];

  for (const record of invalid) {
    expect(cliCapabilitySchema.safeParse(record).success).toBe(false);
  }
});
