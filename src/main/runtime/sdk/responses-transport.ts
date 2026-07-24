import { randomUUID } from "node:crypto";
import type {
  CanonicalEvent,
  CanonicalEventKind,
} from "../../../shared/contracts/event";
import { canonicalEventSchema } from "../../../shared/contracts/event";
import type { RuntimeKind } from "../../../shared/contracts/lane";
import type { TaskId } from "../../../shared/ids";
import type {
  ApprovalResponse,
  NativeSession,
  NativeTurnRequest,
  ResumeSessionRequest,
  RunHandle,
  RuntimeAdapter,
  RuntimeHealth,
  StartSessionRequest,
  UsageCapabilities,
} from "../adapter";
import type { CredentialSource } from "./credential-source";
import type { PreparedToolCall, ToolExecutionContext } from "./workspace-tools";

type JsonRecord = Record<string, unknown>;

interface ToolCall {
  callId: string;
  name: string;
  arguments: JsonRecord;
}

interface ResponsesSession {
  laneId: string;
  nativeSessionId: string;
  model?: string;
  cwd: string;
  permissionMode?: string;
  previousResponseId?: string;
  resumed: boolean;
}

export interface ResponsesAgentTools {
  definitions(): Array<Record<string, unknown>>;
  prepare(
    name: string,
    argumentsValue: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<PreparedToolCall>;
}

export interface ResponsesTransportDependencies {
  kind: RuntimeKind;
  transportId: string;
  baseUrl: string | (() => Promise<string | null>);
  credentialReference: string;
  credential: Pick<CredentialSource, "get">;
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  fetch?: typeof fetch;
  tools?: ResponsesAgentTools;
  createEventId?: (sequence: number) => string;
  clock?: () => Date;
}

export class ResponsesTransportAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind;
  private readonly sessions = new Map<string, ResponsesSession>();
  private readonly active = new Map<string, AbortController>();
  private readonly pendingApprovals = new Map<
    string,
    {
      runId: NativeTurnRequest["runId"];
      resolve: (decision: ApprovalResponse["decision"]) => void;
    }
  >();

  constructor(private readonly dependencies: ResponsesTransportDependencies) {
    this.kind = dependencies.kind;
  }

  async detect(): Promise<RuntimeHealth> {
    const [credential, baseUrl] = await Promise.all([
      this.dependencies.credential.get(),
      this.resolveBaseUrl(),
    ]);
    return credential && baseUrl
      ? {
          available: true,
          protocolSupported: true,
          version: "responses-v1",
        }
      : {
          available: false,
          protocolSupported: true,
          version: "responses-v1",
          detail: `${this.dependencies.credentialReference} or its subscription endpoint is not configured in OkamiCode`,
        };
  }

  async start(request: StartSessionRequest): Promise<NativeSession> {
    await this.requireCredential();
    return this.recordSession(request, randomUUID(), false);
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    await this.requireCredential();
    return this.recordSession(request, request.nativeSessionId, true);
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    if (!request.nativeSessionId) {
      throw new Error(`${this.kind} API requires an Okami session id`);
    }
    const session = this.sessions.get(request.nativeSessionId);
    if (!session || session.laneId !== request.laneId) {
      throw new Error(`Unknown ${this.kind} API session`);
    }
    const controller = new AbortController();
    this.active.set(request.runId, controller);
    return {
      runId: request.runId,
      events: this.events(request, session, controller.signal),
    };
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    const pending = this.pendingApprovals.get(response.approvalId);
    if (!pending || pending.runId !== response.runId) {
      throw new Error(`No pending Okami approval ${response.approvalId}`);
    }
    this.pendingApprovals.delete(response.approvalId);
    pending.resolve(response.decision);
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    this.active.get(runId)?.abort();
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.runId !== runId) continue;
      this.pendingApprovals.delete(approvalId);
      pending.resolve("deny");
    }
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: false,
      contextSnapshot: true,
      activitySnapshot: true,
    };
  }

  private async *events(
    request: NativeTurnRequest,
    session: ResponsesSession,
    signal: AbortSignal,
  ): AsyncGenerator<CanonicalEvent> {
    let sequence = 0;
    const taskId = await this.dependencies.taskIdForRun(request.runId);
    const event = (
      kind: CanonicalEventKind,
      payload: JsonRecord,
      nativeEventId: string | null = null,
    ): CanonicalEvent =>
      canonicalEventSchema.parse({
        schemaVersion: 1,
        id: this.dependencies.createEventId?.(sequence) ?? randomUUID(),
        taskId,
        laneId: request.laneId,
        runId: request.runId,
        sequence: sequence++,
        occurredAt: (this.dependencies.clock?.() ?? new Date()).toISOString(),
        kind,
        nativeEventId,
        payload: {
          runtime: this.kind,
          transport: this.dependencies.transportId,
          ...payload,
        },
      });

    try {
      yield event(
        session.resumed ? "session_resumed" : "session_started",
        { nativeSessionId: session.nativeSessionId },
        session.nativeSessionId,
      );
      session.resumed = true;
      let input: unknown = request.input;
      for (let cycle = 0; cycle < 32; cycle += 1) {
        const responseBody = await this.requestResponse(
          request,
          session,
          input,
          signal,
        );
        let text = "";
        let responseCompleted = false;
        let completedUsage: JsonRecord | undefined;
        const toolCalls: ToolCall[] = [];
        for await (const native of parseSse(responseBody)) {
          if (signal.aborted) break;
          const type = string(native.type);
          const response = record(native.response);
          const responseId = string(response?.id);
          if (responseId) session.previousResponseId = responseId;
          if (type === "response.output_text.delta") {
            const delta = string(native.delta);
            if (!delta) continue;
            text += delta;
            yield event(
              "message_delta",
              { delta, messageAnchor: "assistant-0" },
              string(native.item_id) || null,
            );
            continue;
          }
          if (type === "response.output_item.done") {
            const toolCall = parseToolCall(record(native.item));
            if (toolCall) toolCalls.push(toolCall);
            continue;
          }
          if (type === "response.failed" || type === "error") {
            yield event("run_failed", {
              reason:
                string(record(response?.error)?.message) ||
                string(record(native.error)?.message) ||
                `${this.kind} API stream failed`,
            });
            return;
          }
          if (type !== "response.completed") continue;
          responseCompleted = true;
          completedUsage = record(response?.usage);
        }
        if (signal.aborted) break;
        if (!responseCompleted) {
          yield event("run_failed", {
            reason: `${this.kind} API stream ended without response.completed`,
          });
          return;
        }
        if (text) {
          yield event("message_completed", {
            text,
            messageAnchor: "assistant-0",
            responseId: session.previousResponseId,
          });
        }
        if (completedUsage) {
          yield event("usage_reported", usagePayload(completedUsage));
        }
        if (toolCalls.length === 0) {
          yield event("run_completed", {
            responseId: session.previousResponseId,
          });
          return;
        }
        if (!this.dependencies.tools) {
          yield event("run_failed", {
            reason: `${this.kind} requested tools but the Okami tool loop is unavailable`,
          });
          return;
        }
        const outputs: JsonRecord[] = [];
        for (const toolCall of toolCalls) {
          yield event(
            "tool_call_started",
            {
              callId: toolCall.callId,
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
            toolCall.callId,
          );
          const prepared = await this.dependencies.tools.prepare(
            toolCall.name,
            toolCall.arguments,
            {
              runtime: this.kind,
              taskId,
              laneId: request.laneId,
              runId: request.runId,
              cwd: session.cwd,
              permissionMode: session.permissionMode,
            },
          );
          let allowed = prepared.authorization.decision === "allow";
          if (prepared.authorization.decision === "ask") {
            yield event("approval_requested", {
              approvalId: prepared.authorization.approvalId,
              callId: toolCall.callId,
              capability: prepared.capability,
              resource: prepared.resource,
              risk: "critical",
            });
            const decision = await this.waitForApproval(
              request.runId,
              prepared.authorization.approvalId,
            );
            allowed = decision === "allow_once";
            yield event("approval_resolved", {
              approvalId: prepared.authorization.approvalId,
              decision,
            });
          }
          let output: string;
          let status: "completed" | "denied" | "failed";
          if (!allowed) {
            output = `Tool denied: ${
              prepared.authorization.decision === "deny"
                ? prepared.authorization.reason
                : "approval_denied"
            }`;
            status = "denied";
          } else {
            try {
              output = await prepared.execute();
              status = "completed";
            } catch (error) {
              output = `Tool failed: ${
                error instanceof Error ? error.message : String(error)
              }`;
              status = "failed";
            }
          }
          yield event(
            "tool_call_completed",
            {
              callId: toolCall.callId,
              name: toolCall.name,
              status,
              output,
            },
            toolCall.callId,
          );
          outputs.push({
            type: "function_call_output",
            call_id: toolCall.callId,
            output,
          });
        }
        input = outputs;
      }
      if (!signal.aborted) {
        yield event("run_failed", {
          reason: "Okami agent loop exceeded 32 model continuations",
        });
        return;
      }
      if (signal.aborted) {
        yield event("run_cancelled", { reason: "user_cancelled" });
      }
    } catch (error) {
      if (signal.aborted) {
        yield event("run_cancelled", { reason: "user_cancelled" });
      } else {
        yield event("run_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.active.delete(request.runId);
    }
  }

  private async requestResponse(
    request: NativeTurnRequest,
    session: ResponsesSession,
    input: unknown,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const credential = await this.requireCredential();
    const body: JsonRecord = {
      model: request.model ?? session.model,
      input,
      stream: true,
    };
    if (session.previousResponseId) {
      body.previous_response_id = session.previousResponseId;
    }
    const tools = this.dependencies.tools?.definitions();
    if (tools?.length) body.tools = tools;
    const baseUrl = await this.resolveBaseUrl();
    if (!baseUrl) {
      throw new Error(
        `${this.dependencies.credentialReference} subscription endpoint is unavailable`,
      );
    }
    const response = await (this.dependencies.fetch ?? fetch)(
      `${trimSlash(baseUrl)}/responses`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": request.runId,
        },
        body: JSON.stringify(body),
        signal,
      },
    );
    if (!response.ok || !response.body) {
      const detail = await response
        .text()
        .then((text) => text.slice(0, 300))
        .catch(() => "");
      throw new Error(
        `${this.kind} API returned ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return response.body;
  }

  private resolveBaseUrl(): Promise<string | null> {
    return typeof this.dependencies.baseUrl === "string"
      ? Promise.resolve(this.dependencies.baseUrl)
      : this.dependencies.baseUrl();
  }

  private waitForApproval(
    runId: NativeTurnRequest["runId"],
    approvalId: string,
  ): Promise<ApprovalResponse["decision"]> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(approvalId, { runId, resolve });
    });
  }

  private async requireCredential(): Promise<string> {
    const credential = await this.dependencies.credential.get();
    if (!credential) {
      throw new Error(
        `${this.dependencies.credentialReference} is not configured in OkamiCode`,
      );
    }
    return credential;
  }

  private recordSession(
    request: StartSessionRequest,
    nativeSessionId: string,
    resumed: boolean,
  ): NativeSession {
    this.sessions.set(nativeSessionId, {
      laneId: request.laneId,
      nativeSessionId,
      model: request.model,
      cwd: request.cwd,
      permissionMode: request.permissionMode,
      resumed,
    });
    return {
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId,
      runtimeVersion: "responses-v1",
    };
  }
}

async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<JsonRecord> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const payload = ssePayload(frame);
      if (payload) yield JSON.parse(payload) as JsonRecord;
    }
  }
  buffer += decoder.decode();
  const payload = ssePayload(buffer);
  if (payload) yield JSON.parse(payload) as JsonRecord;
}

function ssePayload(frame: string): string | undefined {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  return !data || data === "[DONE]" ? undefined : data;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseToolCall(item: JsonRecord | undefined): ToolCall | undefined {
  if (!item || item.type !== "function_call") return undefined;
  const callId = string(item.call_id);
  const name = string(item.name);
  const serialized = string(item.arguments);
  if (!callId || !name || !serialized) return undefined;
  const argumentsValue = JSON.parse(serialized) as unknown;
  const argumentsRecord = record(argumentsValue);
  if (!argumentsRecord) throw new Error(`Invalid arguments for tool ${name}`);
  return { callId, name, arguments: argumentsRecord };
}

function usagePayload(usage: JsonRecord): JsonRecord {
  const inputTokens = number(usage.input_tokens);
  const outputTokens = number(usage.output_tokens);
  return {
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: number(
        record(usage.input_tokens_details)?.cached_tokens,
      ),
      reasoning_tokens: number(
        record(usage.output_tokens_details)?.reasoning_tokens,
      ),
      total_tokens: number(usage.total_tokens) || inputTokens + outputTokens,
      source: "provider_response",
    },
  };
}
