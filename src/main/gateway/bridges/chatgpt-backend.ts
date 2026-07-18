import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ChatGptBackend,
  ChatGptBackendRequest,
  ChatGptStreamEvent,
} from "./chatgpt";

type JsonRecord = Record<string, unknown>;

export class BridgeUnhealthyError extends Error {
  readonly code = "bridge_unhealthy";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BridgeUnhealthyError";
  }
}

export interface CodexBackendOptions {
  authPath?: string;
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface CodexOAuth {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  lastRefresh: number;
}

export function createCodexChatGptBackend(
  options: CodexBackendOptions = {},
): ChatGptBackend {
  const authPath =
    options.authPath ?? path.join(homedir(), ".codex", "auth.json");
  const endpoint =
    options.endpoint ?? "https://chatgpt.com/backend-api/codex/responses";
  const fetchRequest = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: CodexOAuth | undefined;

  return {
    async *stream(request) {
      const disk = await readCodexOAuth(authPath);
      if (!cached || disk.lastRefresh > cached.lastRefresh) cached = disk;
      if (tokenExpiresSoon(cached.accessToken, now())) {
        cached = await refreshCodexOAuth(cached, fetchRequest, now);
      }
      let response = await sendCodexRequest(
        endpoint,
        request,
        cached,
        fetchRequest,
      );
      if (response.status === 401) {
        cached = await refreshCodexOAuth(cached, fetchRequest, now);
        response = await sendCodexRequest(
          endpoint,
          request,
          cached,
          fetchRequest,
        );
      }
      if (!response.ok || !response.body) {
        const detail = await response
          .text()
          .then((text) => text.slice(0, 300))
          .catch(() => "");
        throw new BridgeUnhealthyError(
          `ChatGPT backend returned ${response.status}: ${detail}`,
        );
      }
      yield* parseBackendStream(response.body);
    },
  };
}

async function readCodexOAuth(authPath: string): Promise<CodexOAuth> {
  let auth: JsonRecord;
  try {
    auth = JSON.parse(await readFile(authPath, "utf8")) as JsonRecord;
  } catch (error) {
    throw new BridgeUnhealthyError("Unable to read Codex OAuth session", {
      cause: error,
    });
  }
  const tokens = requiredRecord(auth.tokens, "Codex auth tokens");
  return {
    accessToken: requiredString(tokens.access_token, "access_token"),
    refreshToken: requiredString(tokens.refresh_token, "refresh_token"),
    accountId: requiredString(tokens.account_id, "account_id"),
    lastRefresh: Date.parse(string(auth.last_refresh)) || 0,
  };
}

async function refreshCodexOAuth(
  current: CodexOAuth,
  fetchRequest: typeof fetch,
  now: () => number,
): Promise<CodexOAuth> {
  try {
    const response = await fetchRequest("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
    });
    const value = (await response.json()) as JsonRecord;
    if (!response.ok || typeof value.access_token !== "string") {
      throw new Error(`OAuth refresh returned ${response.status}`);
    }
    return {
      accessToken: value.access_token,
      refreshToken:
        typeof value.refresh_token === "string"
          ? value.refresh_token
          : current.refreshToken,
      accountId: current.accountId,
      lastRefresh: now(),
    };
  } catch (error) {
    throw new BridgeUnhealthyError("Codex OAuth token refresh failed", {
      cause: error,
    });
  }
}

function sendCodexRequest(
  endpoint: string,
  request: ChatGptBackendRequest,
  oauth: CodexOAuth,
  fetchRequest: typeof fetch,
): Promise<Response> {
  return fetchRequest(endpoint, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${oauth.accessToken}`,
      "ChatGPT-Account-ID": oauth.accountId,
      "Content-Type": "application/json",
      "User-Agent": "codex_cli_rs/0.144.5",
      originator: "codex_cli_rs",
      version: "0.144.5",
    },
    body: JSON.stringify(request),
  });
}

async function* parseBackendStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ChatGptStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const payload = backendPayload(line);
      if (payload) {
        yield JSON.parse(payload) as ChatGptStreamEvent;
      }
    }
  }
  buffer += decoder.decode();
  const payload = backendPayload(buffer);
  if (payload) {
    yield JSON.parse(payload) as ChatGptStreamEvent;
  }
}

function backendPayload(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "[DONE]") return undefined;
  if (trimmed.startsWith("data:")) {
    const data = trimmed.slice("data:".length).trimStart();
    return data === "[DONE]" ? undefined : data;
  }
  return trimmed.startsWith("{") ? trimmed : undefined;
}

function tokenExpiresSoon(token: string, now: number): boolean {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as JsonRecord;
    return (
      typeof payload.exp === "number" && payload.exp * 1000 <= now + 60_000
    );
  } catch {
    return false;
  }
}

function requiredRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeUnhealthyError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BridgeUnhealthyError(`${label} must be a non-empty string`);
  }
  return value;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
