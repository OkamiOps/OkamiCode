import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { ChatGptBridge } from "./bridges/chatgpt";
import { assertNoAnthropicCredentials, type GatewayProfile } from "./profile";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface GatewayMount {
  profile: GatewayProfile;
  bridge: ChatGptBridge;
}

export interface StartGatewayServerOptions {
  profiles: GatewayMount[];
  bearerToken?: string;
  port?: number;
}

export interface GatewayServer {
  host: typeof HOST;
  port: number;
  baseUrl: string;
  bearerToken: string;
  close(): Promise<void>;
}

export async function startGatewayServer(
  options: StartGatewayServerOptions,
): Promise<GatewayServer> {
  const bearerToken =
    options.bearerToken ?? randomBytes(32).toString("base64url");
  if (!bearerToken) throw new Error("Gateway bearer token must not be empty");
  const mounts = new Map<string, GatewayMount>();
  for (const mount of options.profiles) {
    assertNoAnthropicCredentials(mount.profile);
    const route = `/${encodeURIComponent(mount.profile.id)}/v1/messages`;
    if (mounts.has(route)) {
      throw new Error(`Duplicate gateway profile ${mount.profile.id}`);
    }
    mounts.set(route, mount);
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response, bearerToken, mounts);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== HOST) {
    server.close();
    throw new Error("Gateway failed to bind to IPv4 loopback");
  }
  return {
    host: HOST,
    port: address.port,
    baseUrl: `http://${HOST}:${address.port}`,
    bearerToken,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  bearerToken: string,
  mounts: Map<string, GatewayMount>,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (!authorized(request.headers.authorization, bearerToken)) {
    jsonResponse(response, 401, { error: { type: "unauthorized" } });
    return;
  }
  const pathname = new URL(request.url ?? "/", `http://${HOST}`).pathname;
  const mount = mounts.get(pathname);
  if (!mount) {
    jsonResponse(response, 404, { error: { type: "not_found" } });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    jsonResponse(response, 405, { error: { type: "method_not_allowed" } });
    return;
  }

  try {
    const body = await requestJson(request);
    const iterator = mount.bridge.handleMessages(body)[Symbol.asyncIterator]();
    const first = await iterator.next();
    response.writeHead(200, {
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    if (!first.done) response.write(first.value);
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      response.write(next.value);
    }
    response.end();
  } catch (error) {
    if (process.env.OKAMI_GATEWAY_DEBUG === "1") {
      let cursor: unknown = error;
      while (cursor instanceof Error) {
        process.stderr.write(`[gateway] CAUSE: ${cursor.message}\n`);
        cursor = cursor.cause;
      }
    }
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const type = errorCode(error);
    jsonResponse(response, type === "bridge_unhealthy" ? 503 : 400, {
      error: { type },
    });
  }
}

function authorized(header: string | undefined, token: string): boolean {
  const actual = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function errorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "invalid_request";
}

function jsonResponse(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}
