import { z } from "zod";
import { canonicalEventSchema } from "./event";
import {
  laneStatusSchema,
  permissionModes,
  providerKindSchema,
  runtimeKindSchema,
} from "./lane";
import { isSafeCalendarHttpUrl } from "./calendar-url";

export { ipcChannels, eventChannel, type IpcChannel } from "./channels";
import type { IpcChannel } from "./channels";

const emptyRequestSchema = z.object({}).strict();
const entityIdSchema = z.uuid();
const userTextSchema = z.string().trim().min(1).max(100_000);
// Workspace-free chat and delegated email generation still have dedicated
// lifecycle tests only for the two original runtimes. Cursor is exposed first
// in Workbench and fails closed here until those flows gain equivalent tests.
const delegatedRuntimeKindSchema = z.enum(["claude", "codex"]);
const opaqueReferenceSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_-]*:[a-zA-Z0-9._~-]+$/u);

export const runtimeHealthSchema = z
  .object({
    runtime: runtimeKindSchema,
    status: z.enum(["ready", "degraded", "unavailable"]),
    version: z.string().min(1).nullable(),
    detail: z.enum(["protocol_unsupported", "runtime_unavailable"]).nullable(),
  })
  .strict();

const clientCapabilityRules = {
  codex: {
    role: "runtime",
    statuses: ["ready", "unavailable"],
    capabilities: [
      "sessions",
      "models",
      "effort",
      "approvals",
      "sandbox",
      "mcp",
      "hooks",
      "subagents",
      "background",
      "git",
      "worktrees",
      "usage",
      "automations",
      "structured_output",
      "app_server",
    ],
  },
  claude: {
    role: "runtime",
    statuses: ["ready", "unavailable"],
    capabilities: [
      "sessions",
      "checkpoints",
      "models",
      "effort",
      "approvals",
      "sandbox",
      "browser",
      "mcp",
      "skills",
      "hooks",
      "subagents",
      "background",
      "git",
      "worktrees",
      "usage",
      "automations",
      "structured_output",
    ],
  },
  cursor: {
    role: "runtime",
    statuses: ["ready", "needs_adapter", "unavailable"],
    capabilities: [
      "sessions",
      "models",
      "approvals",
      "sandbox",
      "mcp",
      "git",
      "worktrees",
      "structured_output",
      "plugins",
    ],
  },
  agy: {
    role: "runtime",
    statuses: ["needs_adapter", "unavailable"],
    capabilities: ["sessions", "models", "sandbox", "plugins"],
  },
} as const;

function hasExactCapabilities(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((capability, index) => capability === expected[index])
  );
}

export const cliCapabilitySchema = z
  .object({
    client: z.enum(["codex", "claude", "cursor", "agy"]),
    label: z.string().min(1),
    binaryPath: z.string().min(1).nullable(),
    version: z.string().min(1).nullable(),
    role: z.enum(["runtime", "launcher"]),
    integrationStatus: z.enum([
      "ready",
      "needs_adapter",
      "update_required",
      "unavailable",
    ]),
    detail: z.string().min(1),
    capabilities: z.array(
      z.enum([
        "sessions",
        "models",
        "effort",
        "approvals",
        "sandbox",
        "mcp",
        "hooks",
        "subagents",
        "background",
        "git",
        "worktrees",
        "usage",
        "automations",
        "structured_output",
        "app_server",
        "checkpoints",
        "browser",
        "skills",
        "launcher",
        "plugins",
      ]),
    ),
  })
  .strict()
  .superRefine((client, context) => {
    const rule = clientCapabilityRules[client.client];
    const expectedRole =
      client.client === "cursor" && client.integrationStatus === "needs_adapter"
        ? "launcher"
        : rule.role;
    if (client.role !== expectedRole) {
      context.addIssue({
        code: "custom",
        path: ["role"],
        message: `${client.client} must be a ${expectedRole}`,
      });
    }
    if (
      !(rule.statuses as readonly string[]).includes(client.integrationStatus)
    ) {
      context.addIssue({
        code: "custom",
        path: ["integrationStatus"],
        message: `${client.client} does not support this integration status`,
      });
    }

    if (client.integrationStatus === "unavailable") {
      if (
        client.binaryPath !== null ||
        client.version !== null ||
        client.capabilities.length !== 0
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Unavailable clients must not report local metadata or capabilities",
        });
      }
      return;
    }

    if (client.binaryPath === null) {
      context.addIssue({
        code: "custom",
        path: ["binaryPath"],
        message: "Installed clients require a binary path",
      });
    }
    const capabilitiesValid =
      client.client === "cursor" || client.client === "agy"
        ? client.capabilities.every((capability) =>
            (rule.capabilities as readonly string[]).includes(capability),
          ) && new Set(client.capabilities).size === client.capabilities.length
        : hasExactCapabilities(client.capabilities, rule.capabilities);
    if (!capabilitiesValid) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: `${client.client} capabilities must match the verified local list`,
      });
    }
  });

export const systemDoctorSchema = z
  .object({
    database: z.literal("ok"),
    runtimes: z.array(runtimeHealthSchema),
    clients: z.array(cliCapabilitySchema),
  })
  .strict();

export const taskSchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(["workbench", "quick_chat"]),
    title: z.string().min(1),
    objective: z.string(),
    status: z.string().min(1),
    workspacePath: z.string().min(1).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const taskCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(20_000),
    workspacePath: z.string().min(1).max(4_096).optional(),
    // When the folder is a git repo, the conversation can run on its own
    // worktree so parallel conversations never trample the same checkout.
    useWorktree: z.boolean().optional(),
  })
  .strict();

export const taskListSchema = z.array(taskSchema);

export const taskRenameRequestSchema = z
  .object({
    taskId: entityIdSchema,
    title: z.string().trim().min(1).max(240),
  })
  .strict();

export const taskDeleteRequestSchema = z
  .object({ taskId: entityIdSchema })
  .strict();

export const taskDeleteResultSchema = z
  .object({ taskId: entityIdSchema, deleted: z.boolean() })
  .strict();

export const filePickRequestSchema = z
  .object({ defaultPath: z.string().min(1).max(4_096).optional() })
  .strict();

export const filePickSchema = z
  .object({ paths: z.array(z.string().min(1)) })
  .strict();

export const fsListRequestSchema = z
  .object({
    taskId: entityIdSchema,
    // Relative to the task workspace; empty string means the root.
    dir: z.string().max(4_096).default(""),
  })
  .strict();

export const fsEntrySchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["file", "dir"]),
  })
  .strict();

export const fsListSchema = z
  .object({ entries: z.array(fsEntrySchema) })
  .strict();

export const fsReadRequestSchema = z
  .object({
    taskId: entityIdSchema,
    file: z.string().min(1).max(4_096),
  })
  .strict();

export const fsReadSchema = z
  .object({
    content: z.string(),
    truncated: z.boolean(),
    binary: z.boolean(),
  })
  .strict();

export const fsSearchRequestSchema = z
  .object({
    taskId: entityIdSchema,
    query: z.string().max(200).default(""),
  })
  .strict();

export const fsSearchSchema = z
  .object({ files: z.array(z.string().min(1)) })
  .strict();

export const terminalOpenRequestSchema = z
  .object({ taskId: entityIdSchema })
  .strict();

export const terminalOpenSchema = z
  .object({ termId: z.string().min(1) })
  .strict();

export const terminalWriteRequestSchema = z
  .object({ termId: z.string().min(1), data: z.string().max(65_536) })
  .strict();

export const terminalResizeRequestSchema = z
  .object({
    termId: z.string().min(1),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(300),
  })
  .strict();

export const terminalCloseRequestSchema = z
  .object({ termId: z.string().min(1) })
  .strict();

export const terminalAckSchema = z.object({ ok: z.literal(true) }).strict();

export const workspaceScopedRequestSchema = z
  .object({ workspacePath: z.string().min(1).max(4_096).optional() })
  .strict();

export const mcpServersSchema = z.array(
  z
    .object({
      name: z.string().min(1),
      scope: z.string().min(1),
      transport: z.string().min(1),
      detail: z.string(),
      runtime: z.enum(["claude", "codex"]),
    })
    .strict(),
);

export const skillsSchema = z.array(
  z
    .object({
      name: z.string().min(1),
      description: z.string(),
      source: z.string().min(1),
    })
    .strict(),
);

export const memoryListSchema = z.array(
  z
    .object({
      path: z.string().min(1),
      label: z.string().min(1),
      scope: z.enum(["user", "project"]),
      bytes: z.number().int().nonnegative(),
    })
    .strict(),
);

export const memoryReadRequestSchema = z
  .object({ path: z.string().min(1).max(4_096) })
  .strict();

export const memoryReadSchema = z.object({ content: z.string() }).strict();

export const memoryWriteRequestSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    content: z.string().max(1_000_000),
  })
  .strict();

export const memoryWriteSchema = z.object({ ok: z.literal(true) }).strict();

export const agentsSchema = z.array(
  z
    .object({
      name: z.string().min(1),
      description: z.string(),
      source: z.string().min(1),
      model: z.string().optional(),
      tools: z.string().optional(),
    })
    .strict(),
);

export const cliSettingsSchema = z.array(
  z
    .object({
      path: z.string().min(1),
      exists: z.boolean(),
      keys: z.array(z.string()),
      effortLevel: z.string().optional(),
      theme: z.string().optional(),
      enabledPlugins: z.array(z.string()).optional(),
    })
    .strict(),
);

export const runEventsRequestSchema = z
  .object({ runId: entityIdSchema })
  .strict();

export const runEventsSchema = z.array(canonicalEventSchema);

export const laneSetPermissionModeRequestSchema = z
  .object({
    laneId: entityIdSchema,
    mode: z.enum(permissionModes),
  })
  .strict();

export const laneSetPermissionModeSchema = z
  .object({ laneId: entityIdSchema, mode: z.enum(permissionModes) })
  .strict();

export const taskArchiveRequestSchema = z
  .object({ taskId: entityIdSchema, archived: z.boolean() })
  .strict();

export const taskForkRequestSchema = z
  .object({ taskId: entityIdSchema })
  .strict();

export const conversationExportRequestSchema = z
  .object({ taskId: entityIdSchema })
  .strict();

export const conversationExportSchema = z
  .object({ path: z.string().min(1).nullable() })
  .strict();

export const auditExportRequestSchema = z
  .object({ taskId: entityIdSchema, laneId: entityIdSchema })
  .strict();

export const auditExportSchema = z
  .object({
    path: z.string().min(1).nullable(),
    entryCount: z.number().int().nonnegative(),
  })
  .strict();

export const runListRequestSchema = z
  .object({ taskId: entityIdSchema.optional() })
  .strict();

export const runListSchema = z.array(
  z
    .object({
      runId: entityIdSchema,
      laneId: entityIdSchema,
      model: z.string().min(1),
      status: z.string().min(1),
      startedAt: z.iso.datetime({ offset: true }),
      finishedAt: z.iso.datetime({ offset: true }).nullable(),
      error: z.string().min(1).nullable(),
    })
    .strict(),
);

export const workspacePickRequestSchema = z
  .object({ purpose: z.enum(["workspace", "memory"]).optional() })
  .strict();

export const workspacePickSchema = z
  .object({ path: z.string().min(1).nullable() })
  .strict();

export const conversationHistoryRequestSchema = z
  .object({ taskId: entityIdSchema })
  .strict();

export const conversationHistorySchema = z
  .object({
    userMessages: z.array(
      z
        .object({
          id: z.string().min(1),
          laneId: entityIdSchema.nullable(),
          body: z.string(),
          at: z.iso.datetime({ offset: true }),
        })
        .strict(),
    ),
    events: z.array(canonicalEventSchema),
  })
  .strict();

export const laneOpenRequestSchema = z
  .object({
    laneId: entityIdSchema,
    inheritTask: z.boolean().optional(),
  })
  .strict();

export const laneListRequestSchema = z
  .object({ taskId: entityIdSchema.optional() })
  .strict();

export const laneSummarySchema = z
  .object({
    laneId: entityIdSchema,
    taskId: entityIdSchema,
    harness: z.enum(["claude", "native"]),
    runtimeKind: runtimeKindSchema,
    runtimeVersion: z.string().min(1).nullable(),
    providerAccountLabel: z.string().min(1),
    model: z.string().min(1),
    routeKind: z.enum([
      "direct",
      "compatible",
      "bridged",
      "native",
      "unavailable",
    ]),
    routeReason: z.string().min(1),
    displayQuotaAccount: z.string().min(1),
    permissionMode: z.string().min(1).nullable(),
    workspacePath: z.string().min(1).nullable(),
    nativeSessionIdPrefix: z.string().min(1).nullable(),
    status: laneStatusSchema,
    temperature: z.enum(["hot", "stale", "cold", "clean"]),
    pendingDeltaEvents: z.number().int().nonnegative(),
  })
  .strict();

export const laneListSchema = z.array(laneSummarySchema);

export const laneEnsureRequestSchema = z
  .object({
    taskId: entityIdSchema,
    runtimeKind: runtimeKindSchema,
    model: z.string().trim().min(1).max(120),
  })
  .strict();

export const modelCatalogSchema = z.array(
  z
    .object({
      runtimeKind: runtimeKindSchema,
      providerLabel: z.string().min(1),
      routeKind: z.enum([
        "direct",
        "compatible",
        "bridged",
        "native",
        "unavailable",
      ]),
      source: z.string().min(1),
      models: z.array(
        z
          .object({
            id: z.string().min(1),
            label: z.string().min(1),
            description: z.string().min(1).optional(),
            efforts: z.array(z.string().min(1)).optional(),
            defaultEffort: z.string().min(1).optional(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export const openedLaneSchema = laneSummarySchema;

export const laneSendTurnRequestSchema = z
  .object({
    laneId: entityIdSchema,
    input: userTextSchema,
    effort: z.string().min(1).max(20).optional(),
  })
  .strict();

export const runSummarySchema = z
  .object({
    runId: entityIdSchema,
    laneId: entityIdSchema,
    status: z.literal("running"),
  })
  .strict();

export const runCancelRequestSchema = z
  .object({ runId: entityIdSchema })
  .strict();

export const runCancelResultSchema = z
  .object({
    runId: entityIdSchema,
    cancelled: z.boolean(),
  })
  .strict();

export const approvalResolveRequestSchema = z
  .object({
    approvalId: entityIdSchema,
    decision: z.enum(["allow_once", "deny"]),
  })
  .strict();

export const approvalResultSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    laneId: entityIdSchema,
    status: z.enum(["allowed_once", "denied"]),
    resolvedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const quickChatCreateRequestSchema = z
  .object({ runtime: delegatedRuntimeKindSchema })
  .strict();

const quickChatTurnRequestSchema = z
  .object({
    chatId: entityIdSchema,
    input: userTextSchema,
    contextRefs: z.array(opaqueReferenceSchema).max(100),
  })
  .strict();

const quickChatPromotionRequestSchema = z
  .object({
    chatId: entityIdSchema,
    promotion: z
      .object({
        title: z.string().trim().min(1).max(240),
        objective: z.string().trim().min(1).max(20_000),
        selectedMessageIds: z.array(entityIdSchema).max(1_000),
        contextRefs: z.array(opaqueReferenceSchema).max(100),
      })
      .strict(),
  })
  .strict();

export const quickChatSendRequestSchema = z.union([
  quickChatTurnRequestSchema,
  quickChatPromotionRequestSchema,
]);

export const quickChatConversationSchema = z
  .object({
    id: entityIdSchema,
    taskId: entityIdSchema,
    laneId: entityIdSchema,
    runtime: runtimeKindSchema,
    workspaceId: z.null(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const quickChatPromotionResultSchema = z
  .object({
    task: taskSchema,
    conversationId: entityIdSchema,
    sourceConversationId: entityIdSchema,
    copiedMessageIds: z.array(entityIdSchema),
    contextRefs: z.array(opaqueReferenceSchema),
  })
  .strict();

export const quickChatTurnResultSchema = runSummarySchema.extend({
  messageId: entityIdSchema,
});

export const quickChatSendResultSchema = z.union([
  quickChatTurnResultSchema,
  quickChatPromotionResultSchema,
]);

export const usageAlertSetRequestSchema = z
  .object({
    provider: providerKindSchema,
    accountRef: z.string().regex(/^[a-zA-Z0-9._~-]+$/u),
    remainingPercent: z.number().min(0).max(100),
    enabled: z.boolean(),
  })
  .strict();

export const usageSourceKindSchema = z.enum([
  "official_structured",
  "native_presentational",
  "dashboard_read",
  "local_estimate",
  "unavailable",
]);

export const usageFreshnessSchema = z.enum([
  "live",
  "stale",
  "partial",
  "estimated",
  "unavailable",
]);

const usageSourceSchema = z
  .object({
    adapterVersion: z.string().min(1),
    kind: usageSourceKindSchema,
    method: z.string().min(1),
  })
  .strict();

const usageWindowSchema = z
  .object({
    durationMinutes: z.number().int().positive().nullable(),
    kind: z.string().min(1),
    label: z.string().min(1),
    modelGroup: z.string().min(1).nullable(),
    remainingPercent: z.number().min(0).max(100).nullable(),
    resetsAt: z.iso.datetime({ offset: true }).nullable(),
    usedPercent: z.number().min(0).max(100).nullable(),
  })
  .strict();

export const usageSnapshotSchema = z
  .object({
    accountLabel: z.string().min(1),
    accountRef: z.string().min(1),
    collectedAt: z.iso.datetime({ offset: true }),
    credits: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().min(1).nullable(),
    freshness: usageFreshnessSchema,
    plan: z.string().min(1).nullable(),
    provider: providerKindSchema,
    runtime: runtimeKindSchema,
    source: usageSourceSchema,
    validUntil: z.iso.datetime({ offset: true }).nullable(),
    windows: z.array(usageWindowSchema),
  })
  .strict();

const sessionContextSchema = z
  .object({
    collectedAt: z.iso.datetime({ offset: true }),
    freshness: usageFreshnessSchema,
    laneId: z.string().nullable(),
    remainingTokens: z.number().int().nonnegative().nullable(),
    source: usageSourceSchema,
    usedPercent: z.number().min(0).max(100).nullable(),
  })
  .strict();

const usageActivityBucketSchema = z
  .object({
    bucketStart: z.iso.datetime({ offset: true }),
    cachedInputTokens: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    laneId: z.string().min(1),
    messages: z.number().int().nonnegative(),
    model: z.string().min(1),
    modelCalls: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    provider: providerKindSchema,
    reasoningTokens: z.number().int().nonnegative(),
    runtime: runtimeKindSchema,
    sessions: z.number().int().nonnegative(),
    taskId: z.string().min(1),
    taskLabel: z.string().min(1).optional(),
    toolCalls: z.number().int().nonnegative(),
  })
  .strict();

export const usageAlertSchema = usageAlertSetRequestSchema;

export const usageOverviewSchema = z
  .object({
    activity: z.array(usageActivityBucketSchema),
    alerts: z.array(usageAlertSchema),
    context: sessionContextSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    subscriptions: z.array(usageSnapshotSchema),
  })
  .strict();

export type UsageOverviewContract = z.output<typeof usageOverviewSchema>;
export type UsageSnapshotContract = z.output<typeof usageSnapshotSchema>;
export type UsageActivityBucketContract = z.output<
  typeof usageActivityBucketSchema
>;

export const memoryConfigureRequestSchema = z
  .object({
    paths: z.array(z.string().min(1).max(4_096)).min(1).max(20),
  })
  .strict();

export const memorySearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(1_000),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export const memoryReindexRequestSchema = z
  .object({ sourceId: entityIdSchema })
  .strict();

export const memorySourceSchema = z
  .object({
    id: entityIdSchema,
    rootPath: z.string().min(1),
    scopePath: z.string().min(1),
    accessMode: z.enum(["read", "excluded"]),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const memorySearchResultSchema = z
  .object({
    id: z.number().int().positive(),
    sourceId: entityIdSchema,
    title: z.string().min(1),
    path: z.string().min(1),
    excerpt: z.string(),
    heading: z.string().min(1).nullable(),
    citation: z.string().min(1),
    score: z.number(),
  })
  .strict();

const inboxAccountStatusSchema = z.enum([
  "connected",
  "syncing",
  "degraded",
  "auth_required",
  "paused",
  "unavailable",
]);
const inboxBodyFormatSchema = z.enum(["text", "html"]);
const inboxDirectionSchema = z.enum(["incoming", "outgoing", "draft"]);
const inboxAccountSchema = z
  .object({
    id: entityIdSchema,
    provider: z.enum(["gmail", "imap", "zoho"]),
    displayName: z.string().min(1).max(240),
    address: z.string().min(1).max(320),
    status: inboxAccountStatusSchema,
    syncCursor: z.string().max(8_192).nullable(),
    lastError: z.string().max(2_000).nullable(),
    lastSyncedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const inboxConfigurationSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    secure: z.boolean(),
    mailbox: z.string().trim().min(1).max(512).optional(),
    maxInitialMessages: z.number().int().min(1).max(500).optional(),
    maxMessageBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024)
      .optional(),
  })
  .strict();
const storedInboxConfigurationSchema = inboxConfigurationSchema.extend({
  mailbox: z.string().trim().min(1).max(512),
  maxInitialMessages: z.number().int().min(1).max(500),
  maxMessageBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});
const inboxCredentialSchema = z.discriminatedUnion("kind", [
  z
    .object({
      version: z.literal(1),
      kind: z.literal("imap_password"),
      username: z.string().trim().min(1).max(512),
      password: z.string().min(1).max(4_096),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal("oauth"),
      username: z.string().trim().min(1).max(512),
      accessToken: z.string().min(1).max(16_384),
      refreshToken: z.string().min(1).max(16_384).optional(),
      expiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
]);
const inboxAccountSummarySchema = z
  .object({
    account: inboxAccountSchema,
    configuration: storedInboxConfigurationSchema,
    hasCredential: z.boolean(),
  })
  .strict();
const inboxThreadSchema = z
  .object({
    id: entityIdSchema,
    accountId: entityIdSchema,
    externalThreadId: z.string().min(1).max(4_096),
    subject: z.string().max(2_000),
    snippet: z.string().max(8_000),
    participants: z.array(z.string().min(1).max(512)).max(100),
    unreadCount: z.number().int().nonnegative(),
    lastMessageAt: z.iso.datetime({ offset: true }),
    labels: z.array(z.string().min(1).max(240)).max(100),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const inboxAttachmentSchema = z
  .object({
    providerAttachmentId: z.string().min(1).max(4_096).optional(),
    filename: z.string().min(1).max(1_024).optional(),
    mimeType: z.string().min(1).max(255).optional(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(10 * 1024 * 1024)
      .optional(),
    contentId: z.string().min(1).max(4_096).optional(),
    disposition: z.enum(["attachment", "inline"]).optional(),
  })
  .strict();
const inboxMessageSchema = z
  .object({
    id: entityIdSchema,
    accountId: entityIdSchema,
    threadId: entityIdSchema,
    externalMessageId: z.string().min(1).max(4_096),
    direction: inboxDirectionSchema,
    sender: z.string().min(1).max(512),
    recipients: z.array(z.string().min(1).max(512)).max(100),
    body: z.string().max(2_000_000),
    bodyFormat: inboxBodyFormatSchema,
    sentAt: z.iso.datetime({ offset: true }).nullable(),
    receivedAt: z.iso.datetime({ offset: true }).nullable(),
    attachments: z.array(inboxAttachmentSchema).max(100),
    untrustedContent: z.literal(true),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const inboxThreadCursorSchema = z
  .object({
    lastMessageAt: z.iso.datetime({ offset: true }),
    id: entityIdSchema,
  })
  .strict();
const inboxThreadsListRequestSchema = z
  .object({
    accountIds: z.array(entityIdSchema).min(1).max(50).optional(),
    unreadOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: inboxThreadCursorSchema.optional(),
  })
  .strict();
const inboxThreadPageSchema = z
  .object({
    threads: z.array(inboxThreadSchema),
    nextCursor: inboxThreadCursorSchema.nullable(),
  })
  .strict();
const inboxThreadDetailSchema = z
  .object({ thread: inboxThreadSchema, messages: z.array(inboxMessageSchema) })
  .strict();
const inboxSyncResultSchema = z
  .object({
    account: inboxAccountSchema,
    counts: z
      .object({
        inserted: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
const inboxRemoveAccountResultSchema = z
  .object({ accountId: entityIdSchema, removed: z.literal(true) })
  .strict();
const inboxAddAccountRequestSchema = z
  .object({
    provider: z.enum(["gmail", "imap", "zoho"]),
    displayName: z.string().trim().min(1).max(240),
    address: z.string().trim().min(1).max(320),
    configuration: inboxConfigurationSchema,
    credential: inboxCredentialSchema,
  })
  .strict();
const inboxAccountIdRequestSchema = z
  .object({ accountId: entityIdSchema })
  .strict();
const inboxUpdateCredentialRequestSchema = z
  .object({
    accountId: entityIdSchema,
    credential: inboxCredentialSchema,
  })
  .strict();
const inboxConnectGoogleRequestSchema = z.object({}).strict();
const inboxOutgoingSettingsConfigurationSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    secure: z.boolean(),
    fromAddresses: z.array(z.email().trim().max(320)).max(50).optional(),
  })
  .strict();
const inboxOutgoingSettingsRequestSchema = z
  .object({
    accountId: entityIdSchema,
    configuration: inboxOutgoingSettingsConfigurationSchema,
  })
  .strict();
const inboxOutgoingSettingsSchema = z
  .object({
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    secure: z.boolean(),
    fromAddresses: z.array(z.email().max(320)).max(50),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const inboxReplyApproveAndSendRequestSchema = z
  .object({
    outboxId: entityIdSchema,
    confirmation: z.literal("approve_and_send"),
  })
  .strict();
const inboxReplyDiscardRequestSchema = z
  .object({
    outboxId: entityIdSchema,
    threadId: entityIdSchema,
    confirmation: z.literal("discard_unsent_draft"),
  })
  .strict();
const inboxReplyDiscardResultSchema = z
  .object({
    outboxId: entityIdSchema,
    sourceThreadId: entityIdSchema,
    discarded: z.literal(true),
  })
  .strict();
const inboxReplyDispatchSchema = z
  .object({
    id: entityIdSchema,
    status: z.enum(["dispatching", "confirmed", "uncertain"]),
    attempts: z.number().int().nonnegative(),
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
    lastError: z.string().min(1).nullable(),
  })
  .strict();
const inboxThreadIdRequestSchema = z
  .object({ threadId: entityIdSchema })
  .strict();
const inboxThreadMoveToSpamRequestSchema = z
  .object({
    threadId: entityIdSchema,
    confirmation: z.literal("move_to_spam"),
  })
  .strict();
const inboxThreadMoveToTrashRequestSchema = z
  .object({
    threadId: entityIdSchema,
    confirmation: z.literal("move_to_trash"),
  })
  .strict();
const inboxThreadMoveResultSchema = z
  .object({
    threadId: entityIdSchema,
    destination: z.enum(["spam", "trash"]),
    moved: z.literal(true),
  })
  .strict();

export const kanbanStatuses = [
  "backlog",
  "in_progress",
  "review",
  "done",
] as const;
export const kanbanActivationPolicies = [
  "manual",
  "relevant_change",
  "status_transition",
] as const;

export const kanbanCardSchema = z
  .object({
    id: entityIdSchema,
    taskId: entityIdSchema.nullable(),
    title: z.string().min(1).max(240),
    description: z.string().max(8_000),
    status: z.enum(kanbanStatuses),
    ownerKind: z.enum(["human", "lane"]),
    laneId: entityIdSchema.nullable(),
    activationPolicy: z.enum(kanbanActivationPolicies),
    position: z.number().int().nonnegative(),
    stateHash: z.string().min(1),
    lastProcessedHash: z.string().min(1),
    lastProcessedCursor: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type KanbanCardContract = z.output<typeof kanbanCardSchema>;

export const kanbanWakeDecisionSchema = z
  .object({
    shouldWake: z.boolean(),
    reason: z.string().min(1),
    delta: z
      .object({
        stateChanged: z.boolean(),
        statusChanged: z.boolean(),
        ownerChanged: z.boolean(),
        laneChanged: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const kanbanMutationSchema = z
  .object({ card: kanbanCardSchema, wake: kanbanWakeDecisionSchema })
  .strict();

export const kanbanCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    description: z.string().max(8_000),
    status: z.enum(kanbanStatuses),
    ownerKind: z.enum(["human", "lane"]),
    laneId: entityIdSchema.nullable(),
    activationPolicy: z.enum(kanbanActivationPolicies),
  })
  .strict();

export const kanbanMoveRequestSchema = z
  .object({
    cardId: entityIdSchema,
    status: z.enum(kanbanStatuses),
    position: z.number().int().nonnegative(),
    idempotencyKey: entityIdSchema,
  })
  .strict();

export const kanbanAssignRequestSchema = z
  .object({
    cardId: entityIdSchema,
    ownerKind: z.enum(["human", "lane"]),
    laneId: entityIdSchema.nullable(),
    activationPolicy: z.enum(kanbanActivationPolicies),
    idempotencyKey: entityIdSchema,
  })
  .strict();

const inboxThreadCreateTaskRequestSchema = z
  .object({
    threadId: entityIdSchema,
    mode: z.enum(["manual", "delegate"]),
    laneId: entityIdSchema.nullable(),
    title: z.string().trim().min(1).max(240).optional(),
    idempotencyKey: entityIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "manual" && value.laneId !== null) {
      context.addIssue({
        code: "custom",
        message: "manual tasks require laneId to be null",
        path: ["laneId"],
      });
    }
    if (value.mode === "delegate" && value.laneId === null) {
      context.addIssue({
        code: "custom",
        message: "delegated tasks require a laneId",
        path: ["laneId"],
      });
    }
  });

const inboxThreadCreateTaskResultSchema = z
  .object({
    actionId: entityIdSchema,
    sourceThreadId: entityIdSchema,
    card: kanbanCardSchema,
    executionStarted: z.literal(false),
  })
  .strict();

const inboxThreadCreateReplyDraftRequestSchema = z
  .object({
    threadId: entityIdSchema,
    body: z.string().trim().min(1).max(20_000),
    fromAddress: z.email().trim().max(320).optional(),
    idempotencyKey: entityIdSchema,
  })
  .strict();

const inboxThreadCreateForwardDraftRequestSchema = z
  .object({
    threadId: entityIdSchema,
    to: z.array(z.email().trim().max(320)).min(1).max(20),
    note: z.string().trim().max(20_000).optional(),
    fromAddress: z.email().trim().max(320).optional(),
    idempotencyKey: entityIdSchema,
  })
  .strict();

const inboxThreadGenerateReplyDraftRequestSchema = z
  .object({
    threadId: entityIdSchema,
    runtimeKind: delegatedRuntimeKindSchema,
    model: z.string().trim().min(1).max(120),
    effort: z.string().trim().min(1).max(20).optional(),
    fromAddress: z.email().trim().max(320).optional(),
    instructions: z.string().trim().min(1).max(4_000),
  })
  .strict();

const inboxThreadCreateReplyDraftResultSchema = z
  .object({
    id: entityIdSchema,
    sourceThreadId: entityIdSchema,
    connectorAccountId: entityIdSchema,
    fromAddress: z.email().max(320).nullable(),
    messageType: z.enum(["reply", "forward"]),
    to: z.array(z.string().min(1).max(2_000)).min(1).max(100),
    subject: z.string().min(1).max(2_000),
    body: z.string().min(1).max(100_000),
    status: z.literal("approval_pending"),
    requiresApproval: z.literal(true),
    safeRetry: z.literal(false),
    attempts: z.literal(0),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const inboxThreadReplyActionSchema = z
  .object({
    id: entityIdSchema,
    sourceThreadId: entityIdSchema,
    connectorAccountId: entityIdSchema,
    fromAddress: z.email().max(320).nullable(),
    messageType: z.enum(["reply", "forward"]),
    to: z.array(z.string().min(1).max(2_000)).min(1).max(100),
    subject: z.string().min(1).max(2_000),
    body: z.string().min(1).max(100_000),
    status: z.enum([
      "draft",
      "approval_pending",
      "dispatching",
      "confirmed",
      "uncertain",
      "failed_retryable",
      "failed_terminal",
    ]),
    requiresApproval: z.boolean(),
    safeRetry: z.boolean(),
    attempts: z.number().int().nonnegative(),
    approvedAt: z.iso.datetime({ offset: true }).nullable(),
    lastError: z.string().min(1).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const calendarDateSchema = z.iso.date();
const calendarTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const calendarOptionalTextSchema = (maximum: number) =>
  calendarTextSchema(maximum).nullable().optional();
const calendarTimestampSchema = z.iso.datetime({ offset: true });
const calendarSafeHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(isSafeCalendarHttpUrl, {
    message: "Calendar URL must be public HTTP(S) without credentials",
  });
const calendarOptionalSafeHttpUrlSchema = calendarSafeHttpUrlSchema
  .nullable()
  .optional();
const calendarEventStatusSchema = z.enum([
  "confirmed",
  "tentative",
  "cancelled",
]);

export const calendarSourceSchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(["local", "google", "outlook", "caldav", "ics"]),
    displayName: calendarTextSchema(255),
    color: z.string().regex(/^#[0-9A-F]{6}$/u),
    timezone: calendarTextSchema(255),
    status: z.enum(["active", "not_configured", "paused", "degraded"]),
    syncCursor: z.string().min(1).max(8_192).nullable(),
    lastError: z.string().min(1).max(2_000).nullable(),
    lastSyncedAt: calendarTimestampSchema.nullable(),
    createdAt: calendarTimestampSchema,
    updatedAt: calendarTimestampSchema,
  })
  .strict();

const calendarEventFieldsSchema = {
  id: entityIdSchema,
  sourceId: entityIdSchema,
  externalId: calendarTextSchema(4_096),
  title: calendarTextSchema(1_000),
  description: calendarTextSchema(20_000).nullable(),
  location: calendarTextSchema(2_000).nullable(),
  organizer: calendarTextSchema(512).nullable(),
  joinUrl: calendarSafeHttpUrlSchema.nullable(),
  sourceUrl: calendarSafeHttpUrlSchema.nullable(),
  etag: calendarTextSchema(4_096).nullable(),
  providerUpdatedAt: calendarTimestampSchema.nullable(),
  attendees: z.array(calendarTextSchema(512)).max(100),
  status: calendarEventStatusSchema,
  timezone: calendarTextSchema(255),
  deletedAt: calendarTimestampSchema.nullable(),
  createdAt: calendarTimestampSchema,
  updatedAt: calendarTimestampSchema,
};

export const calendarEventSchema = z.discriminatedUnion("allDay", [
  z
    .object({
      ...calendarEventFieldsSchema,
      allDay: z.literal(false),
      startsAt: calendarTimestampSchema,
      endsAt: calendarTimestampSchema,
      startDate: z.null(),
      endDate: z.null(),
    })
    .strict(),
  z
    .object({
      ...calendarEventFieldsSchema,
      allDay: z.literal(true),
      startsAt: z.null(),
      endsAt: z.null(),
      startDate: calendarDateSchema,
      endDate: calendarDateSchema,
    })
    .strict(),
]);

const calendarEventInputFields = {
  sourceId: entityIdSchema,
  title: calendarTextSchema(1_000),
  timezone: calendarTextSchema(255),
  description: calendarOptionalTextSchema(20_000),
  location: calendarOptionalTextSchema(2_000),
  organizer: calendarOptionalTextSchema(512),
  joinUrl: calendarOptionalSafeHttpUrlSchema,
  sourceUrl: calendarOptionalSafeHttpUrlSchema,
  attendees: z.array(calendarTextSchema(512)).max(100).optional(),
  status: calendarEventStatusSchema.optional(),
};

export const calendarCreateLocalSourceRequestSchema = z
  .object({
    displayName: calendarTextSchema(255),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/u),
    timezone: calendarTextSchema(255),
  })
  .strict();

export const calendarCreateLinkedSourceRequestSchema = z
  .object({
    accountId: entityIdSchema,
    protocol: z.enum(["caldav", "ics"]),
    authentication: z.enum(["account", "none"]),
    calendarUrl: calendarSafeHttpUrlSchema,
    displayName: calendarTextSchema(255),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/u),
    timezone: calendarTextSchema(255),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.protocol === "caldav" && value.authentication !== "account") {
      context.addIssue({
        code: "custom",
        path: ["authentication"],
        message: "CalDAV requires account authentication",
      });
    }
  });

export const calendarCreateLocalEventRequestSchema = z.discriminatedUnion(
  "allDay",
  [
    z
      .object({
        ...calendarEventInputFields,
        allDay: z.literal(false),
        startsAt: calendarTimestampSchema,
        endsAt: calendarTimestampSchema,
      })
      .strict(),
    z
      .object({
        ...calendarEventInputFields,
        allDay: z.literal(true),
        startDate: calendarDateSchema,
        endDate: calendarDateSchema,
      })
      .strict(),
  ],
);

export const calendarUpdateLocalEventRequestSchema = z
  .object({
    eventId: entityIdSchema,
    sourceId: entityIdSchema,
    title: calendarTextSchema(1_000).optional(),
    timezone: calendarTextSchema(255).optional(),
    description: calendarOptionalTextSchema(20_000),
    location: calendarOptionalTextSchema(2_000),
    organizer: calendarOptionalTextSchema(512),
    joinUrl: calendarOptionalSafeHttpUrlSchema,
    sourceUrl: calendarOptionalSafeHttpUrlSchema,
    attendees: z.array(calendarTextSchema(512)).max(100).optional(),
    status: calendarEventStatusSchema.optional(),
    allDay: z.boolean().optional(),
    startsAt: calendarTimestampSchema.optional(),
    endsAt: calendarTimestampSchema.optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
  })
  .strict();

export const calendarListEventsRequestSchema = z
  .object({
    sourceIds: z.array(entityIdSchema).max(100).optional(),
    startsAt: calendarTimestampSchema.optional(),
    endsAt: calendarTimestampSchema.optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    for (const [start, end, label] of [
      ["startsAt", "endsAt", "timed"],
      ["startDate", "endDate", "all-day"],
    ] as const) {
      if ((input[start] === undefined) !== (input[end] === undefined)) {
        context.addIssue({
          code: "custom",
          path: [start],
          message: `${label} window requires both boundaries`,
        });
      }
    }
  });

export const calendarDeleteLocalEventRequestSchema = z
  .object({ eventId: entityIdSchema, sourceId: entityIdSchema })
  .strict();
const calendarDeleteLocalEventResultSchema = z
  .object({ eventId: entityIdSchema, deleted: z.literal(true) })
  .strict();

export const ipcRequestSchemas = {
  "system:doctor": emptyRequestSchema,
  "models:list": emptyRequestSchema,
  "task:create": taskCreateRequestSchema,
  "task:rename": taskRenameRequestSchema,
  "task:delete": taskDeleteRequestSchema,
  "workspace:pick": workspacePickRequestSchema,
  "file:pick": filePickRequestSchema,
  "fs:list": fsListRequestSchema,
  "fs:read": fsReadRequestSchema,
  "fs:search": fsSearchRequestSchema,
  "terminal:open": terminalOpenRequestSchema,
  "terminal:write": terminalWriteRequestSchema,
  "terminal:resize": terminalResizeRequestSchema,
  "terminal:close": terminalCloseRequestSchema,
  "run:list": runListRequestSchema,
  "run:events": runEventsRequestSchema,
  "lane:setPermissionMode": laneSetPermissionModeRequestSchema,
  "task:archive": taskArchiveRequestSchema,
  "task:fork": taskForkRequestSchema,
  "conversation:export": conversationExportRequestSchema,
  "audit:export": auditExportRequestSchema,
  "eco:mcp": workspaceScopedRequestSchema,
  "eco:skills": emptyRequestSchema,
  "eco:memoryList": workspaceScopedRequestSchema,
  "eco:memoryRead": memoryReadRequestSchema,
  "eco:memoryWrite": memoryWriteRequestSchema,
  "eco:settings": emptyRequestSchema,
  "eco:agents": workspaceScopedRequestSchema,
  "task:list": emptyRequestSchema,
  "kanban:list": emptyRequestSchema,
  "kanban:create": kanbanCreateRequestSchema,
  "kanban:move": kanbanMoveRequestSchema,
  "kanban:assign": kanbanAssignRequestSchema,
  "lane:list": laneListRequestSchema,
  "conversation:history": conversationHistoryRequestSchema,
  "lane:ensure": laneEnsureRequestSchema,
  "lane:open": laneOpenRequestSchema,
  "lane:sendTurn": laneSendTurnRequestSchema,
  "run:cancel": runCancelRequestSchema,
  "approval:resolve": approvalResolveRequestSchema,
  "quickChat:create": quickChatCreateRequestSchema,
  "quickChat:send": quickChatSendRequestSchema,
  "usage:overview": emptyRequestSchema,
  "usage:refresh": emptyRequestSchema,
  "usage:alertSet": usageAlertSetRequestSchema,
  "memory:configure": memoryConfigureRequestSchema,
  "memory:list": emptyRequestSchema,
  "memory:search": memorySearchRequestSchema,
  "memory:reindex": memoryReindexRequestSchema,
  "calendar:sources:list": emptyRequestSchema,
  "calendar:source:createLocal": calendarCreateLocalSourceRequestSchema,
  "calendar:source:createLinked": calendarCreateLinkedSourceRequestSchema,
  "calendar:events:list": calendarListEventsRequestSchema,
  "calendar:event:createLocal": calendarCreateLocalEventRequestSchema,
  "calendar:event:updateLocal": calendarUpdateLocalEventRequestSchema,
  "calendar:event:deleteLocal": calendarDeleteLocalEventRequestSchema,
  "inbox:accounts:list": emptyRequestSchema,
  "inbox:account:add": inboxAddAccountRequestSchema,
  "inbox:account:remove": inboxAccountIdRequestSchema,
  "inbox:account:sync": inboxAccountIdRequestSchema,
  "inbox:account:updateCredential": inboxUpdateCredentialRequestSchema,
  "inbox:account:connectGoogle": inboxConnectGoogleRequestSchema,
  "inbox:account:reauthorizeGoogle": inboxAccountIdRequestSchema,
  "inbox:account:outgoing:get": inboxAccountIdRequestSchema,
  "inbox:account:outgoing:set": inboxOutgoingSettingsRequestSchema,
  "inbox:threads:list": inboxThreadsListRequestSchema,
  "inbox:thread:get": inboxThreadIdRequestSchema,
  "inbox:thread:markRead": inboxThreadIdRequestSchema,
  "inbox:thread:moveToSpam": inboxThreadMoveToSpamRequestSchema,
  "inbox:thread:moveToTrash": inboxThreadMoveToTrashRequestSchema,
  "inbox:thread:createTask": inboxThreadCreateTaskRequestSchema,
  "inbox:thread:createReplyDraft": inboxThreadCreateReplyDraftRequestSchema,
  "inbox:thread:createForwardDraft": inboxThreadCreateForwardDraftRequestSchema,
  "inbox:thread:generateReplyDraft": inboxThreadGenerateReplyDraftRequestSchema,
  "inbox:thread:replyActions:list": inboxThreadIdRequestSchema,
  "inbox:reply:discard": inboxReplyDiscardRequestSchema,
  "inbox:reply:approveAndSend": inboxReplyApproveAndSendRequestSchema,
} satisfies Record<IpcChannel, z.ZodType>;

export const ipcResponseSchemas = {
  "system:doctor": systemDoctorSchema,
  "models:list": modelCatalogSchema,
  "task:create": taskSchema,
  "task:rename": taskSchema,
  "task:delete": taskDeleteResultSchema,
  "workspace:pick": workspacePickSchema,
  "file:pick": filePickSchema,
  "fs:list": fsListSchema,
  "fs:read": fsReadSchema,
  "fs:search": fsSearchSchema,
  "terminal:open": terminalOpenSchema,
  "terminal:write": terminalAckSchema,
  "terminal:resize": terminalAckSchema,
  "terminal:close": terminalAckSchema,
  "run:list": runListSchema,
  "run:events": runEventsSchema,
  "lane:setPermissionMode": laneSetPermissionModeSchema,
  "task:archive": taskSchema,
  "task:fork": taskSchema,
  "conversation:export": conversationExportSchema,
  "audit:export": auditExportSchema,
  "eco:mcp": mcpServersSchema,
  "eco:skills": skillsSchema,
  "eco:memoryList": memoryListSchema,
  "eco:memoryRead": memoryReadSchema,
  "eco:memoryWrite": memoryWriteSchema,
  "eco:settings": cliSettingsSchema,
  "eco:agents": agentsSchema,
  "task:list": taskListSchema,
  "kanban:list": z.array(kanbanCardSchema),
  "kanban:create": kanbanMutationSchema,
  "kanban:move": kanbanMutationSchema,
  "kanban:assign": kanbanMutationSchema,
  "lane:list": laneListSchema,
  "conversation:history": conversationHistorySchema,
  "lane:ensure": openedLaneSchema,
  "lane:open": openedLaneSchema,
  "lane:sendTurn": runSummarySchema,
  "run:cancel": runCancelResultSchema,
  "approval:resolve": approvalResultSchema,
  "quickChat:create": quickChatConversationSchema,
  "quickChat:send": quickChatSendResultSchema,
  "usage:overview": usageOverviewSchema,
  "usage:refresh": usageOverviewSchema,
  "usage:alertSet": usageAlertSchema,
  "memory:configure": z.array(memorySourceSchema),
  "memory:list": z.array(memorySourceSchema),
  "memory:search": z.array(memorySearchResultSchema),
  "memory:reindex": z
    .object({
      indexed: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
    })
    .strict(),
  "calendar:sources:list": z.array(calendarSourceSchema),
  "calendar:source:createLocal": calendarSourceSchema,
  "calendar:source:createLinked": calendarSourceSchema,
  "calendar:events:list": z.array(calendarEventSchema),
  "calendar:event:createLocal": calendarEventSchema,
  "calendar:event:updateLocal": calendarEventSchema,
  "calendar:event:deleteLocal": calendarDeleteLocalEventResultSchema,
  "inbox:accounts:list": z.array(inboxAccountSummarySchema),
  "inbox:account:add": inboxAccountSummarySchema,
  "inbox:account:remove": inboxRemoveAccountResultSchema,
  "inbox:account:sync": inboxSyncResultSchema,
  "inbox:account:updateCredential": inboxSyncResultSchema,
  "inbox:account:connectGoogle": inboxAccountSummarySchema,
  "inbox:account:reauthorizeGoogle": inboxSyncResultSchema,
  "inbox:account:outgoing:get": inboxOutgoingSettingsSchema.nullable(),
  "inbox:account:outgoing:set": inboxOutgoingSettingsSchema,
  "inbox:threads:list": inboxThreadPageSchema,
  "inbox:thread:get": inboxThreadDetailSchema,
  "inbox:thread:markRead": inboxThreadSchema,
  "inbox:thread:moveToSpam": inboxThreadMoveResultSchema,
  "inbox:thread:moveToTrash": inboxThreadMoveResultSchema,
  "inbox:thread:createTask": inboxThreadCreateTaskResultSchema,
  "inbox:thread:createReplyDraft": inboxThreadCreateReplyDraftResultSchema,
  "inbox:thread:createForwardDraft": inboxThreadCreateReplyDraftResultSchema,
  "inbox:thread:generateReplyDraft": inboxThreadCreateReplyDraftResultSchema,
  "inbox:thread:replyActions:list": z.array(inboxThreadReplyActionSchema),
  "inbox:reply:discard": inboxReplyDiscardResultSchema,
  "inbox:reply:approveAndSend": inboxReplyDispatchSchema,
} satisfies Record<IpcChannel, z.ZodType>;

export type IpcRequest<C extends IpcChannel> = z.input<
  (typeof ipcRequestSchemas)[C]
>;
export type IpcResponse<C extends IpcChannel> = z.output<
  (typeof ipcResponseSchemas)[C]
>;

export type IpcInvokeFacade = {
  readonly [C in IpcChannel]: (payload: IpcRequest<C>) => Promise<unknown>;
};

export interface OkamiBridge {
  readonly bridgeVersion: 1;
  readonly invoke: IpcInvokeFacade;
  onEvent(listener: (event: unknown) => void): () => void;
  onTerminalData(listener: (chunk: unknown) => void): () => void;
}
