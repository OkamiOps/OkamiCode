import { z } from "zod";
import {
  laneStatusSchema,
  providerKindSchema,
  runtimeKindSchema,
} from "./lane";

export const ipcChannels = [
  "system:doctor",
  "task:create",
  "task:list",
  "lane:list",
  "lane:open",
  "lane:sendTurn",
  "run:cancel",
  "approval:resolve",
  "quickChat:create",
  "quickChat:send",
  "usage:overview",
  "usage:refresh",
  "usage:alertSet",
  "memory:configure",
  "memory:search",
  "memory:reindex",
] as const;

export const eventChannel = "workbench:event" as const;
export type IpcChannel = (typeof ipcChannels)[number];

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
export const openedLaneSchema = laneSummarySchema;

export const laneSendTurnRequestSchema = z
  .object({
    laneId: entityIdSchema,
    input: userTextSchema,
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

export const quickChatSendRequestSchema = z
  .object({
    chatId: entityIdSchema,
    input: userTextSchema,
    contextRefs: z.array(opaqueReferenceSchema).max(100),
  })
  .strict();

export const usageAlertSetRequestSchema = z
  .object({
    provider: providerKindSchema,
    accountRef: z.string().regex(/^[a-zA-Z0-9._~-]+$/u),
    remainingPercent: z.number().min(0).max(100),
    enabled: z.boolean(),
  })
  .strict();

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
  "task:create": taskCreateRequestSchema,
  "task:list": emptyRequestSchema,
  "lane:list": laneListRequestSchema,
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
  "task:create": taskSchema,
  "task:list": taskListSchema,
  "lane:list": laneListSchema,
  "lane:open": openedLaneSchema,
  "lane:sendTurn": runSummarySchema,
  "run:cancel": runCancelResultSchema,
  "approval:resolve": approvalResultSchema,
  "quickChat:create": notImplementedSchema("quickChat:create"),
  "quickChat:send": notImplementedSchema("quickChat:send"),
  "usage:overview": notImplementedSchema("usage:overview"),
  "usage:refresh": notImplementedSchema("usage:refresh"),
  "usage:alertSet": notImplementedSchema("usage:alertSet"),
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
