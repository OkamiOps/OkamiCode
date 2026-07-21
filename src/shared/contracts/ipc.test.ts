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
  binaryPath: "/bin/cursor-agent",
  version: "2026.07.17-3e2a980",
  role: "runtime",
  integrationStatus: "ready",
  detail: "CLI cursor-agent encontrado e protocolo stream-json compatível.",
  capabilities: [
    "sessions",
    "models",
    "sandbox",
    "mcp",
    "git",
    "worktrees",
    "structured_output",
    "plugins",
  ],
};

it("accepts the verified Cursor runtime capability record", () => {
  expect(cliCapabilitySchema.safeParse(cursor).success).toBe(true);
});

it("accepts only the AGY runtime capabilities proven by the local help", () => {
  const agy = {
    client: "agy",
    label: "AGY",
    binaryPath: "/bin/agy",
    version: "1.1.1",
    role: "runtime",
    integrationStatus: "needs_adapter",
    detail: "CLI encontrado; aguarda companion local de hooks JSON.",
    capabilities: ["sessions", "models", "sandbox", "plugins"],
  };

  expect(cliCapabilitySchema.safeParse(agy).success).toBe(true);
  expect(
    cliCapabilitySchema.safeParse({
      ...agy,
      capabilities: [...agy.capabilities, "approvals"],
    }).success,
  ).toBe(false);
  expect(
    cliCapabilitySchema.safeParse({
      ...agy,
      capabilities: [...agy.capabilities, "subagents"],
    }).success,
  ).toBe(false);
});

it("rejects invalid roles, statuses, capability sets, and unavailable invariants per client", () => {
  const invalid = [
    {
      ...cursor,
      role: "launcher",
    },
    {
      ...cursor,
      capabilities: [...cursor.capabilities, "app_server"],
    },
    {
      ...cursor,
      integrationStatus: "unavailable",
      binaryPath: "/bin/cursor-agent",
      version: "2026.07.17-3e2a980",
      capabilities: cursor.capabilities,
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
    "inbox:account:updateCredential",
    "inbox:threads:list",
    "inbox:thread:get",
    "inbox:thread:markRead",
    "inbox:thread:markUnread",
    "inbox:thread:moveToSpam",
    "inbox:thread:moveToTrash",
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
    ipcRequestSchemas["inbox:account:updateCredential"].safeParse({
      accountId,
      credential: base.credential,
    }).success,
  ).toBe(true);
  expect(
    ipcRequestSchemas["inbox:account:add"].safeParse({
      ...base,
      provider: "gmail",
      address: "marcos@gmail.com",
      configuration: {
        ...base.configuration,
        host: "imap.gmail.com",
      },
      credential: {
        ...base.credential,
        username: "marcos@gmail.com",
        password: "app-password",
      },
    }).success,
  ).toBe(true);
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
  expect(
    ipcRequestSchemas["inbox:thread:moveToSpam"].safeParse({
      threadId: accountId,
      confirmation: "move_to_spam",
    }).success,
  ).toBe(true);
  expect(
    ipcRequestSchemas["inbox:thread:moveToTrash"].safeParse({
      threadId: accountId,
      confirmation: "move_to_trash",
    }).success,
  ).toBe(true);
  expect(
    ipcRequestSchemas["inbox:thread:analyze"].safeParse({
      threadId: accountId,
      runtimeKind: "codex",
      model: "gpt-5.6-sol",
      effort: "medium",
      action: "summary",
      instructions: "Resuma em português.",
    }).success,
  ).toBe(true);
  expect(
    ipcRequestSchemas["inbox:thread:analyze"].safeParse({
      threadId: accountId,
      runtimeKind: "codex",
      model: "gpt-5.6-sol",
      action: "summary",
      instructions: "",
    }).success,
  ).toBe(false);
  expect(
    ipcRequestSchemas["inbox:reply:discard"].safeParse({
      outboxId: accountId,
      threadId: accountId,
      confirmation: "discard_unsent_draft",
    }).success,
  ).toBe(true);
  expect(
    ipcRequestSchemas["inbox:reply:discard"].safeParse({
      outboxId: accountId,
      threadId: accountId,
    }).success,
  ).toBe(false);
});

it("exposes a strict public-only linked Calendar source contract", () => {
  const request = {
    accountId: "b672d2e8-688b-48ac-a618-3294bfc96a99",
    protocol: "caldav",
    calendarUrl: "https://calendar.example/caldav/marcos",
    displayName: "Trabalho",
    color: "#FF7A1A",
    timezone: "America/Sao_Paulo",
    authentication: "account",
  };
  expect(
    ipcRequestSchemas["calendar:source:createLinked"].safeParse(request)
      .success,
  ).toBe(true);
  expect(
    ipcRequestSchemas["calendar:source:createLinked"].safeParse({
      ...request,
      protocol: "ics",
      authentication: "none",
      calendarUrl:
        "https://calendar.google.com/calendar/ical/private/basic.ics",
    }).success,
  ).toBe(true);
  expect(
    ipcRequestSchemas["calendar:source:createLinked"].safeParse({
      ...request,
      calendarUrl: "https://user:secret@calendar.example/feed.ics",
    }).success,
  ).toBe(false);
  expect(
    ipcRequestSchemas["calendar:source:createLinked"].safeParse({
      ...request,
      password: "secret",
    }).success,
  ).toBe(false);
  expect(ipcChannels).toContain("calendar:source:createLinked");
  expect(ipcResponseSchemas["calendar:source:createLinked"]).toBeDefined();
});
