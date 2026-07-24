import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createChatGptBridge,
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
  it("translates an anthropic messages request with tools into a chatgpt turn and back", async () => {
    const backend = await fakeChatGptBackend(
      "tests/fixtures/gateway/chatgpt-stream.jsonl",
    );
    const observedUsage: Array<Record<string, unknown>> = [];
    const bridge = createChatGptBridge(backend, {
      model: "gpt-5.6-sol",
      onUsage: (_laneId, usage) => observedUsage.push(usage),
    });
    const request = await readJson(
      "tests/fixtures/gateway/anthropic-messages-request.json",
    );

    const events = await collectSse(
      bridge.handleMessages(request, { laneId: "lane-chatgpt" }),
    );

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
    expect(observedUsage).toEqual([
      {
        aggregation: "delta",
        complete: true,
        input_token_semantics: "includes_cache_read",
        input_tokens: 27,
        observed_total_tokens: 39,
        output_tokens: 12,
        reported_total_tokens: 39,
        scope: "turn",
        source: "provider",
      },
    ]);
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
