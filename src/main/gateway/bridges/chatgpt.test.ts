import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createChatGptBridge,
  createCodexChatGptBackend,
  type ChatGptBackend,
  type ChatGptBackendRequest,
  type ChatGptStreamEvent,
} from "./chatgpt";

class ReplayBackend implements ChatGptBackend {
  readonly requests: ChatGptBackendRequest[] = [];

  constructor(private readonly events: ChatGptStreamEvent[]) {}

  async *stream(request: ChatGptBackendRequest) {
    this.requests.push(request);
    yield* this.events;
  }
}

describe("ChatGPT bridge", () => {
  it("parses named SSE events from the Codex subscription backend", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "okami-chatgpt-backend-"),
    );
    const authPath = path.join(temporaryDirectory, "auth.json");
    await writeFile(
      authPath,
      JSON.stringify({
        tokens: {
          access_token: "fixture-access-token",
          refresh_token: "fixture-refresh-token",
          account_id: "fixture-account",
        },
        last_refresh: "2099-01-01T00:00:00.000Z",
      }),
    );
    const requests: RequestInit[] = [];
    const backend = createCodexChatGptBackend({
      authPath,
      fetch: (_input, init) => {
        requests.push(init ?? {});
        return Promise.resolve(
          new Response(
            [
              "event: response.created",
              'data: {"type":"response.created","response":{"id":"resp_sse"}}',
              "",
              "event: response.completed",
              'data: {"type":"response.completed","response":{"id":"resp_sse"}}',
              "",
            ].join("\n"),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
        );
      },
    });
    try {
      const events = [];
      for await (const event of backend.stream(backendRequest())) {
        events.push(event);
      }
      expect(events.map((event) => event.type)).toEqual([
        "response.created",
        "response.completed",
      ]);
      expect(requests[0]?.headers).toMatchObject({
        Authorization: "Bearer fixture-access-token",
        "ChatGPT-Account-ID": "fixture-account",
        "User-Agent": "codex_cli_rs/0.144.5",
        originator: "codex_cli_rs",
        version: "0.144.5",
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("translates an anthropic messages request with tools into a chatgpt turn and back", async () => {
    const backend = await fakeChatGptBackend(
      "tests/fixtures/gateway/chatgpt-stream.jsonl",
    );
    const bridge = createChatGptBridge(backend, { model: "gpt-5.6-sol" });
    const request = await readJson(
      "tests/fixtures/gateway/anthropic-messages-request.json",
    );

    const events = await collectSse(bridge.handleMessages(request));

    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]).toMatchObject({
      // The profile's backend model wins over the Anthropic model id sent by the harness.
      model: "gpt-5.6-sol",
      instructions: "Be concise and use tools when needed.",
      stream: true,
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get current weather",
        },
      ],
    });
    expect(backend.requests[0]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function_call",
          call_id: "toolu_weather",
          name: "get_weather",
        }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "toolu_weather",
          output: "Sunny, 21 C",
        }),
      ]),
    );
    expect(events.some((event) => event.type === "content_block_delta")).toBe(
      true,
    );
    expect(
      events.some(
        (event) =>
          event.type === "content_block_start" &&
          event.content_block?.type === "tool_use",
      ),
    ).toBe(true);
    expect(events.at(-1)?.type).toBe("message_stop");
  });

  it("surfaces an OAuth refresh failure as bridge_unhealthy", async () => {
    const backend: ChatGptBackend = {
      stream() {
        throw new Error("oauth refresh failed");
      },
    };
    const bridge = createChatGptBridge(backend, { model: "gpt-5.6-sol" });

    await expect(
      collectSse(bridge.handleMessages({ model: "gpt-5.2", messages: [] })),
    ).rejects.toMatchObject({ code: "bridge_unhealthy" });
  });
});

function backendRequest(): ChatGptBackendRequest {
  return {
    model: "gpt-5.2",
    instructions: "",
    input: [],
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: null,
    store: false,
    stream: true,
    include: [],
  };
}

async function fakeChatGptBackend(filePath: string): Promise<ReplayBackend> {
  const jsonl = await readFile(path.resolve(filePath), "utf8");
  const events = jsonl
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChatGptStreamEvent);
  return new ReplayBackend(events);
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8")) as Record<
    string,
    unknown
  >;
}

interface AnthropicSseEvent {
  type: string;
  content_block?: { type?: string };
}

async function collectSse(
  stream: AsyncIterable<string>,
): Promise<AnthropicSseEvent[]> {
  const events: AnthropicSseEvent[] = [];
  for await (const frame of stream) {
    const data = frame
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    if (data) events.push(JSON.parse(data) as AnthropicSseEvent);
  }
  return events;
}
