import { describe, expect, it, vi } from "vitest";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { ChatCompletionsTransportAdapter } from "./chat-completions-transport";

const laneId = "11111111-1111-4111-8111-111111111111" as LaneId;
const runId = "22222222-2222-4222-8222-222222222222" as RunId;
const taskId = "33333333-3333-4333-8333-333333333333" as TaskId;

describe("ChatCompletionsTransportAdapter", () => {
  it("streams text and exact MiniMax usage through canonical events", async () => {
    const fetchRequest = vi.fn(async () =>
      sseResponse([
        {
          id: "chat-1",
          choices: [{ index: 0, delta: { content: "Olá" } }],
        },
        {
          id: "chat-1",
          choices: [
            { index: 0, delta: { content: " mundo" }, finish_reason: "stop" },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 7,
            total_tokens: 27,
            completion_tokens_details: { reasoning_tokens: 4 },
          },
        },
      ]),
    );
    const adapter = createAdapter(fetchRequest);
    const session = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "MiniMax-M2.7",
    });

    const events = await collect(
      (
        await adapter.sendTurn({
          laneId,
          runId,
          nativeSessionId: session.nativeSessionId,
          input: "Olá",
        })
      ).events,
    );

    expect(events.map((event) => event.kind)).toEqual([
      "session_started",
      "message_delta",
      "message_delta",
      "message_completed",
      "usage_reported",
      "run_completed",
    ]);
    expect(
      events.find((event) => event.kind === "usage_reported")?.payload,
    ).toMatchObject({
      transport: "minimax-api",
      usage: {
        input_tokens: 20,
        output_tokens: 7,
        reasoning_tokens: 4,
        total_tokens: 27,
        source: "provider_response",
      },
    });
  });

  it("keeps conversation history inside the Okami session", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchRequest = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sseResponse([
          {
            id: `chat-${bodies.length}`,
            choices: [
              {
                index: 0,
                delta: { content: `answer-${bodies.length}` },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]);
      },
    );
    const adapter = createAdapter(fetchRequest);
    const session = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "MiniMax-M2.7",
    });

    for (const [id, input] of [
      [runId, "one"],
      ["44444444-4444-4444-8444-444444444444" as RunId, "two"],
    ] as const) {
      await collect(
        (
          await adapter.sendTurn({
            laneId,
            runId: id,
            nativeSessionId: session.nativeSessionId,
            input,
          })
        ).events,
      );
    }

    expect(bodies[1]?.messages).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "answer-1" },
      { role: "user", content: "two" },
    ]);
  });

  it("signals lost history only after adapter reconstruction", async () => {
    const first = createAdapter(vi.fn());
    const started = await first.start({
      laneId,
      cwd: "/workspace",
      model: "MiniMax-M2.7",
    });
    if (started.bindingState !== "authoritative") {
      throw new Error("Expected authoritative MiniMax session");
    }

    await expect(
      first.resume({
        laneId,
        cwd: "/workspace",
        model: "MiniMax-M2.7",
        nativeSessionId: started.nativeSessionId,
      }),
    ).resolves.not.toHaveProperty("rehydration");

    const reconstructed = createAdapter(vi.fn());
    await expect(
      reconstructed.resume({
        laneId,
        cwd: "/workspace",
        model: "MiniMax-M2.7",
        nativeSessionId: started.nativeSessionId,
      }),
    ).resolves.toMatchObject({
      rehydration: {
        required: true,
        reason: "transport_continuation_unavailable",
      },
    });
  });
});

function createAdapter(
  fetchRequest: typeof fetch,
): ChatCompletionsTransportAdapter {
  return new ChatCompletionsTransportAdapter({
    kind: "minimax",
    transportId: "minimax-api",
    baseUrl: "https://api.minimax.io/v1",
    credentialReference: "MINIMAX_API_KEY",
    credential: { get: async () => "okami-minimax-key" },
    taskIdForRun: async () => taskId,
    fetch: fetchRequest,
    createEventId: (sequence) => `event-${sequence}`,
    clock: () => new Date("2026-07-24T10:00:00.000Z"),
  });
}

function sseResponse(events: unknown[]): Response {
  return new Response(
    `${events
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("")}data: [DONE]\n\n`,
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
