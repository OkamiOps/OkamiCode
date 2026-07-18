import { z } from "zod";

export const canonicalEventKindSchema = z.enum([
  "session_started",
  "session_resumed",
  "message_delta",
  "message_completed",
  "tool_call_started",
  "tool_call_updated",
  "tool_call_completed",
  "approval_requested",
  "approval_resolved",
  "subagent_started",
  "subagent_completed",
  "usage_reported",
  "rate_limit_updated",
  "run_failed",
  "run_completed",
]);

export const canonicalEventSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  taskId: z.uuid(),
  laneId: z.uuid(),
  runId: z.uuid(),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime({ offset: true }),
  kind: canonicalEventKindSchema,
  nativeEventId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
export type CanonicalEventKind = z.infer<typeof canonicalEventKindSchema>;
