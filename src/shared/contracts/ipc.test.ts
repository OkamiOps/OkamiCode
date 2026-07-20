import { expect, it } from "vitest";
import {
  cliCapabilitySchema,
  ipcRequestSchemas,
  ipcResponseSchemas,
} from "./ipc";
import { ipcChannels } from "./channels";

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

it("exposes strict Inbox contracts in both IPC maps", () => {
  const accountId = "b672d2e8-688b-48ac-a618-3294bfc96a99";
  const base = {
    provider: "imap",
    displayName: "Primary inbox",
    address: "me@example.com",
    configuration: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      mailbox: "INBOX",
      maxInitialMessages: 100,
      maxMessageBytes: 2_097_152,
    },
    credential: {
      version: 1,
      kind: "imap_password",
      username: "me@example.com",
      password: "secret",
    },
  };
  const inboxChannels = [
    "inbox:accounts:list",
    "inbox:account:add",
    "inbox:account:remove",
    "inbox:account:sync",
    "inbox:threads:list",
    "inbox:thread:get",
    "inbox:thread:markRead",
  ] as const;

  for (const channel of inboxChannels) {
    expect(ipcChannels).toContain(channel);
    expect(ipcRequestSchemas[channel]).toBeDefined();
    expect(ipcResponseSchemas[channel]).toBeDefined();
  }
  expect(ipcRequestSchemas["inbox:account:add"].safeParse(base).success).toBe(
    true,
  );
  expect(
    ipcRequestSchemas["inbox:account:add"].safeParse({
      ...base,
      credential: { ...base.credential, password: "secret", extra: true },
    }).success,
  ).toBe(false);
  expect(
    ipcRequestSchemas["inbox:account:add"].safeParse({
      ...base,
      unexpected: true,
    }).success,
  ).toBe(false);
  expect(
    ipcRequestSchemas["inbox:thread:get"].safeParse({ threadId: accountId }),
  ).toMatchObject({ success: true });
});
