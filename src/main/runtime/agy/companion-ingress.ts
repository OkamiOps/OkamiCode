import type { CanonicalEvent } from "../../../shared/contracts/event";
import {
  AgyHookProjector,
  parseAgyHook,
  type AgyHookProjectionContext,
  type ParsedAgyHook,
} from "./hook-contract";

export interface AgyCompanionHookEnvelope {
  hookName: string;
  payload: unknown;
}

export type AgyCompanionIngressContext = AgyHookProjectionContext;

/**
 * Pure boundary for a future companion transport. It keeps hook replays from
 * creating duplicate canonical events while one lane/run owns one AGY chat.
 */
export class AgyCompanionIngress {
  private readonly projector: AgyHookProjector;
  private readonly delivered = new Set<string>();
  private associatedConversationId: string | undefined;

  constructor(context: AgyCompanionIngressContext) {
    this.projector = new AgyHookProjector(context);
  }

  get conversationId(): string | undefined {
    return this.associatedConversationId;
  }

  receive(envelope: AgyCompanionHookEnvelope): CanonicalEvent[] {
    const hook = parseAgyHook(envelope.hookName, envelope.payload);
    if (!hook) return [];

    if (
      this.associatedConversationId !== undefined &&
      this.associatedConversationId !== hook.conversationId
    ) {
      throw new Error("AGY companion conversationId changed during the run");
    }

    const replayKey = hookReplayKey(hook, envelope.payload);
    if (this.delivered.has(replayKey)) return [];

    const events = this.projector.project(envelope.hookName, envelope.payload);
    this.associatedConversationId ??= hook.conversationId;
    this.delivered.add(replayKey);
    return events;
  }

  completeStdout(stdout: string, includeTerminal = true): CanonicalEvent[] {
    return this.projector.completeStdout(stdout, includeTerminal);
  }

  projectFailure(reason: string): CanonicalEvent {
    return this.projector.projectFailure(reason);
  }

  projectCancellation(): CanonicalEvent {
    return this.projector.projectCancellation();
  }

  get hasPendingTerminal(): boolean {
    return this.projector.hasPendingTerminal;
  }

  discardPendingTerminal(): void {
    this.projector.discardPendingTerminal();
  }
}

function hookReplayKey(hook: ParsedAgyHook, payload: unknown): string {
  return [
    hook.hookName,
    hook.conversationId,
    stableHookIdentity(hook),
    stableJson(payload),
  ].join(":");
}

function stableHookIdentity(hook: ParsedAgyHook): number {
  switch (hook.hookName) {
    case "PreInvocation":
      return hook.invocationNum;
    case "PreToolUse":
    case "PostToolUse":
      return hook.stepIdx;
    case "Stop":
      return hook.executionNum;
  }
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}
