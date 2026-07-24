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

type JsonRecord = Record<string, unknown>;
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

interface ChatSession {
  laneId: StartSessionRequest["laneId"];
  nativeSessionId: string;
  model?: string;
  history: ChatMessage[];
  resumed: boolean;
}

export interface ChatCompletionsTransportDependencies {
  kind: RuntimeKind;
  transportId: string;
  baseUrl: string;
  credentialReference: string;
  credential: Pick<CredentialSource, "get">;
  taskIdForRun: (runId: NativeTurnRequest["runId"]) => TaskId | Promise<TaskId>;
  fetch?: typeof fetch;
  createEventId?: (sequence: number) => string;
  clock?: () => Date;
}

export class ChatCompletionsTransportAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind;
  private readonly sessions = new Map<string, ChatSession>();
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly dependencies: ChatCompletionsTransportDependencies,
  ) {
    this.kind = dependencies.kind;
  }

  async detect(): Promise<RuntimeHealth> {
    const credential = await this.dependencies.credential.get();
    return credential
      ? {
          available: true,
          protocolSupported: true,
          version: "chat-completions-v1",
        }
      : {
          available: false,
          protocolSupported: true,
          version: "chat-completions-v1",
          detail: `${this.dependencies.credentialReference} is not configured in OkamiCode`,
        };
  }

  async start(request: StartSessionRequest): Promise<NativeSession> {
    await this.requireCredential();
    return this.record(request, randomUUID(), false);
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    await this.requireCredential();
    const existing = this.sessions.get(request.nativeSessionId);
    if (existing) {
      if (existing.laneId !== request.laneId) {
        throw new Error(`${this.kind} chat session belongs to another lane`);
      }
      existing.model = request.model;
      return this.nativeSession(existing);
    }
    return this.record(request, request.nativeSessionId, true, true);
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    if (!request.nativeSessionId) {
      throw new Error(`${this.kind} API requires an Okami session id`);
    }
    const session = this.sessions.get(request.nativeSessionId);
    if (!session || session.laneId !== request.laneId) {
      throw new Error(`Unknown ${this.kind} chat session`);
    }
    const credential = await this.requireCredential();
    const controller = new AbortController();
    this.active.set(request.runId, controller);
    const messages: ChatMessage[] = [
      ...session.history,
      { role: "user", content: request.input },
    ];
    const response = await (this.dependencies.fetch ?? fetch)(
      `${trimSlash(this.dependencies.baseUrl)}/chat/completions`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": request.runId,
        },
        body: JSON.stringify({
          model: request.model ?? session.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok || !response.body) {
      this.active.delete(request.runId);
      const detail = await response
        .text()
        .then((text) => text.slice(0, 300))
        .catch(() => "");
      throw new Error(
        `${this.kind} API returned ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return {
      runId: request.runId,
      events: this.events(
        request,
        session,
        messages,
        response.body,
        controller.signal,
      ),
    };
  }

  respondToApproval(response: ApprovalResponse): Promise<void> {
    void response;
    return Promise.reject(
      new Error("Chat Completions approvals require the Okami tool loop"),
    );
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    this.active.get(runId)?.abort();
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
    session: ChatSession,
    messages: ChatMessage[],
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): AsyncGenerator<CanonicalEvent> {
    let sequence = 0;
    let text = "";
    let completed = false;
    let usage: JsonRecord | undefined;
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
      for await (const chunk of parseSse(body)) {
        if (signal.aborted) break;
        const choice = firstRecord(chunk.choices);
        const delta = record(choice?.delta);
        const content = string(delta?.content);
        if (content) {
          text += content;
          yield event(
            "message_delta",
            { delta: content, messageAnchor: "assistant-0" },
            string(chunk.id) || null,
          );
        }
        if (choice?.finish_reason) completed = true;
        usage = record(chunk.usage) ?? usage;
      }
      if (signal.aborted) {
        yield event("run_cancelled", { reason: "user_cancelled" });
        return;
      }
      if (!completed) {
        yield event("run_failed", {
          reason: `${this.kind} API stream ended without finish_reason`,
        });
        return;
      }
      session.history = [...messages, { role: "assistant", content: text }];
      yield event("message_completed", {
        text,
        messageAnchor: "assistant-0",
      });
      if (usage) {
        const inputTokens = number(usage.prompt_tokens);
        const outputTokens = number(usage.completion_tokens);
        yield event("usage_reported", {
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            reasoning_tokens: number(
              record(usage.completion_tokens_details)?.reasoning_tokens,
            ),
            total_tokens:
              number(usage.total_tokens) || inputTokens + outputTokens,
            source: "provider_response",
          },
        });
      }
      yield event("run_completed", {});
    } catch (error) {
      yield event(signal.aborted ? "run_cancelled" : "run_failed", {
        reason: signal.aborted
          ? "user_cancelled"
          : error instanceof Error
            ? error.message
            : String(error),
      });
    } finally {
      this.active.delete(request.runId);
    }
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

  private record(
    request: StartSessionRequest,
    nativeSessionId: string,
    resumed: boolean,
    historyUnavailable = false,
  ): NativeSession {
    const session: ChatSession = {
      laneId: request.laneId,
      nativeSessionId,
      model: request.model,
      history: [],
      resumed,
    };
    this.sessions.set(nativeSessionId, session);
    return this.nativeSession(session, historyUnavailable);
  }

  private nativeSession(
    session: ChatSession,
    historyUnavailable = false,
  ): NativeSession {
    return {
      laneId: session.laneId,
      bindingState: "authoritative",
      nativeSessionId: session.nativeSessionId,
      runtimeVersion: "chat-completions-v1",
      ...(historyUnavailable
        ? {
            rehydration: {
              required: true as const,
              reason: "transport_continuation_unavailable" as const,
            },
          }
        : {}),
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

function firstRecord(value: unknown): JsonRecord | undefined {
  return Array.isArray(value) ? record(value[0]) : undefined;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
