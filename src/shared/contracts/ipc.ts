import { z } from "zod";
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

export const systemDoctorSchema = z
  .object({
    database: z.literal("ok"),
    runtimes: z.array(runtimeHealthSchema),
  })
  .strict();

export const taskSchema = z
  .object({
    id: entityIdSchema,
    kind: z.enum(["workbench", "quick_chat"]),
    title: z.string().min(1),
    objective: z.string(),
    status: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const taskCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const taskListSchema = z.array(taskSchema);

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
    sourceId: entityIdSchema.optional(),
    scopeRefs: z.array(opaqueReferenceSchema).max(100),
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

function notImplementedSchema<C extends IpcChannel>(channel: C) {
  return z
    .object({
      status: z.literal("not_implemented"),
      channel: z.literal(channel),
    })
    .strict();
}

export const ipcRequestSchemas = {
  "system:doctor": emptyRequestSchema,
  "models:list": emptyRequestSchema,
  "task:create": taskCreateRequestSchema,
  "task:list": emptyRequestSchema,
  "lane:list": laneListRequestSchema,
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
  "memory:search": memorySearchRequestSchema,
  "memory:reindex": memoryReindexRequestSchema,
} satisfies Record<IpcChannel, z.ZodType>;

export const ipcResponseSchemas = {
  "system:doctor": systemDoctorSchema,
  "models:list": modelCatalogSchema,
  "task:create": taskSchema,
  "task:list": taskListSchema,
  "lane:list": laneListSchema,
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
  "memory:configure": notImplementedSchema("memory:configure"),
  "memory:search": notImplementedSchema("memory:search"),
  "memory:reindex": notImplementedSchema("memory:reindex"),
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
}
