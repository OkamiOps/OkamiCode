import type { JsonlProcess } from "../transport";

export type JsonRpcId = number | string;
export type CodexServerMessage = Record<string, unknown> & {
  method: string;
  id?: JsonRpcId;
  params?: unknown;
};

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class CodexRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "CodexRpcError";
  }
}

export class CodexClient {
  private requestId = 0;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly inbox = new MessageQueue<CodexServerMessage>();
  private readonly reader: Promise<void>;
  private closing = false;

  constructor(private readonly process: JsonlProcess) {
    this.reader = this.readMessages();
  }

  async initialize(appVersion = "0.1.0"): Promise<Record<string, unknown>> {
    const result = await this.request<Record<string, unknown>>("initialize", {
      clientInfo: {
        name: "okami-workbench",
        title: "Okami Workbench",
        version: appVersion,
      },
      capabilities: { experimentalApi: false },
    });
    await this.notify("initialized", {});
    return result;
  }

  startThread(
    cwd: string,
    options?: {
      model?: string;
      ephemeral?: boolean;
      approvalPolicy?: "on-request";
      approvalsReviewer?: "user";
    },
  ): Promise<Record<string, unknown>> {
    return this.request("thread/start", { cwd, ...options });
  }

  resumeThread(
    threadId: string,
    options?: {
      cwd?: string;
      model?: string;
      approvalPolicy?: "on-request";
      approvalsReviewer?: "user";
    },
  ): Promise<Record<string, unknown>> {
    return this.request("thread/resume", { threadId, ...options });
  }

  startTurn(threadId: string, input: string): Promise<Record<string, unknown>> {
    return this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: input }],
    });
  }

  interruptTurn(
    threadId: string,
    turnId: string,
  ): Promise<Record<string, unknown>> {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  readRateLimits(): Promise<Record<string, unknown>> {
    return this.request("account/rateLimits/read");
  }

  readUsage(): Promise<Record<string, unknown>> {
    return this.request("account/usage/read");
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (this.closing) throw new Error("Codex app-server client is closing");
    const id = ++this.requestId;
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });

    try {
      await this.process.send(
        params === undefined ? { method, id } : { method, id, params },
      );
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return response;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.process.send(
      params === undefined ? { method } : { method, params },
    );
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    await this.process.send({ id, result });
  }

  nextServerMessage(): Promise<CodexServerMessage | undefined> {
    return this.inbox.next();
  }

  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = true;
      await this.process.cancel();
    }
    await this.process.wait();
    await this.reader;
  }

  private async readMessages(): Promise<void> {
    try {
      for (;;) {
        const message = await this.process.next();
        if (message === undefined) break;
        const envelope = record(message);
        if (!envelope) continue;

        if ("id" in envelope && !("method" in envelope)) {
          this.resolveResponse(envelope);
          continue;
        }
        if (typeof envelope.method === "string") {
          this.inbox.push(envelope as CodexServerMessage);
        }
      }
      this.failPending(new Error("Codex app-server closed before responding"));
    } catch (error) {
      this.failPending(asError(error));
    } finally {
      this.inbox.close();
    }
  }

  private resolveResponse(envelope: Record<string, unknown>): void {
    const id = envelope.id;
    if (typeof id !== "number" && typeof id !== "string") return;
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);

    const error = record(envelope.error);
    if (error) {
      request.reject(
        new CodexRpcError(
          typeof error.message === "string"
            ? error.message
            : "Codex app-server request failed",
          typeof error.code === "number" ? error.code : undefined,
          error.data,
        ),
      );
      return;
    }
    request.resolve(envelope.result);
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

class MessageQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  next(): Promise<T | undefined> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve(value);
    if (this.ended) return Promise.resolve(undefined);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter(undefined);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
