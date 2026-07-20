import { z } from "zod";
import { canonicalEventSchema } from "./event";
import {
  laneStatusSchema,
  providerKindSchema,
  runtimeKindSchema,
} from "./lane";

export { ipcChannels, eventChannel, type IpcChannel } from "./channels";
import type { IpcChannel } from "./channels";

const emptyRequestSchema = z.object({}).strict();
const entityIdSchema = z.uuid();
const userTextSchema = z.string().trim().min(1).max(100_000);
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
    role: "launcher",
    statuses: ["needs_adapter", "update_required", "unavailable"],
    capabilities: ["launcher", "mcp"],
  },
  agy: {
    role: "launcher",
    statuses: ["needs_adapter", "unavailable"],
    capabilities: [
      "sessions",
      "models",
      "approvals",
      "sandbox",
      "subagents",
      "plugins",
    ],
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
    if (client.role !== rule.role) {
      context.addIssue({
        code: "custom",
        path: ["role"],
        message: `${client.client} must be a ${rule.role}`,
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
    if (!hasExactCapabilities(client.capabilities, rule.capabilities)) {
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

export const permissionModes = [
  "manual",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
] as const;

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
  .object({ runtime: runtimeKindSchema })
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
  "eco:mcp": workspaceScopedRequestSchema,
  "eco:skills": emptyRequestSchema,
  "eco:memoryList": workspaceScopedRequestSchema,
  "eco:memoryRead": memoryReadRequestSchema,
  "eco:memoryWrite": memoryWriteRequestSchema,
  "eco:settings": emptyRequestSchema,
  "eco:agents": workspaceScopedRequestSchema,
  "task:list": emptyRequestSchema,
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
  "eco:mcp": mcpServersSchema,
  "eco:skills": skillsSchema,
  "eco:memoryList": memoryListSchema,
  "eco:memoryRead": memoryReadSchema,
  "eco:memoryWrite": memoryWriteSchema,
  "eco:settings": cliSettingsSchema,
  "eco:agents": agentsSchema,
  "task:list": taskListSchema,
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
