import { describe, expect, it, vi } from "vitest";
import type { RuntimeKind } from "../../../shared/contracts/lane";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import { ResponsesTransportAdapter } from "./responses-transport";

const laneId = "11111111-1111-4111-8111-111111111111" as LaneId;
const runId = "22222222-2222-4222-8222-222222222222" as RunId;
const taskId = "33333333-3333-4333-8333-333333333333" as TaskId;

describe("ResponsesTransportAdapter", () => {
  it("streams canonical text and exact provider usage", async () => {
    const fetchRequest = vi.fn(async () =>
      sseResponse([
        {
          type: "response.created",
          response: { id: "response-1" },
        },
        {
          type: "response.output_text.delta",
          delta: "Olá",
        },
        {
          type: "response.output_text.delta",
          delta: " mundo",
        },
        {
          type: "response.completed",
          response: {
            id: "response-1",
            usage: {
              input_tokens: 120,
              output_tokens: 8,
              input_tokens_details: { cached_tokens: 40 },
              output_tokens_details: { reasoning_tokens: 3 },
            },
          },
        },
      ]),
    );
    const adapter = createAdapter("grok", fetchRequest);
    const session = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "grok-4.3",
    });

    const handle = await adapter.sendTurn({
      laneId,
      runId,
      nativeSessionId: session.nativeSessionId,
      input: "Continue",
      model: "grok-4.3",
    });
    const events = await collect(handle.events);

    expect(events.map((event) => event.kind)).toEqual([
      "session_started",
      "message_delta",
      "message_delta",
      "message_completed",
      "usage_reported",
      "run_completed",
    ]);
    expect(
      events.find((event) => event.kind === "message_completed")?.payload,
    ).toMatchObject({ text: "Olá mundo", responseId: "response-1" });
    expect(
      events.find((event) => event.kind === "usage_reported")?.payload,
    ).toMatchObject({
      runtime: "grok",
      transport: "xai-api",
      usage: {
        input_tokens: 120,
        output_tokens: 8,
        cached_input_tokens: 40,
        reasoning_tokens: 3,
        total_tokens: 128,
        source: "provider_response",
      },
    });
  });

  it("continues the provider session without replaying the entire conversation", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchRequest = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return sseResponse([
          {
            type: "response.created",
            response: { id: `response-${bodies.length}` },
          },
          {
            type: "response.completed",
            response: {
              id: `response-${bodies.length}`,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        ]);
      },
    );
    const adapter = createAdapter("codex", fetchRequest);
    const session = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "gpt-5",
    });

    await collect(
      (
        await adapter.sendTurn({
          laneId,
          runId,
          nativeSessionId: session.nativeSessionId,
          input: "one",
          model: "gpt-5",
        })
      ).events,
    );
    await collect(
      (
        await adapter.sendTurn({
          laneId,
          runId: "44444444-4444-4444-8444-444444444444" as RunId,
          nativeSessionId: session.nativeSessionId,
          input: "two",
          model: "gpt-5",
        })
      ).events,
    );

    expect(bodies).toEqual([
      expect.objectContaining({ input: "one", stream: true }),
      expect.objectContaining({
        input: "two",
        stream: true,
        previous_response_id: "response-1",
      }),
    ]);
  });

  it("signals lost continuation only after adapter reconstruction", async () => {
    const first = createAdapter("mimo", vi.fn());
    const started = await first.start({
      laneId,
      cwd: "/workspace",
      model: "mimo-v2-pro",
    });
    if (started.bindingState !== "authoritative") {
      throw new Error("Expected authoritative Responses session");
    }

    await expect(
      first.resume({
        laneId,
        cwd: "/workspace",
        model: "mimo-v2-pro",
        nativeSessionId: started.nativeSessionId,
      }),
    ).resolves.not.toHaveProperty("rehydration");

    const reconstructed = createAdapter("mimo", vi.fn());
    await expect(
      reconstructed.resume({
        laneId,
        cwd: "/workspace",
        model: "mimo-v2-pro",
        nativeSessionId: started.nativeSessionId,
      }),
    ).resolves.toMatchObject({
      rehydration: {
        required: true,
        reason: "transport_continuation_unavailable",
      },
    });
  });

  it("executes Okami tools and continues the response with function output", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchRequest = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return bodies.length === 1
          ? sseResponse([
              {
                type: "response.created",
                response: { id: "response-tools" },
              },
              {
                type: "response.output_item.done",
                item: {
                  type: "function_call",
                  call_id: "call-read",
                  name: "read_file",
                  arguments: '{"path":"README.md"}',
                },
              },
              {
                type: "response.completed",
                response: {
                  id: "response-tools",
                  usage: { input_tokens: 10, output_tokens: 2 },
                },
              },
            ])
          : sseResponse([
              {
                type: "response.output_text.delta",
                delta: "Li o arquivo.",
              },
              {
                type: "response.completed",
                response: {
                  id: "response-final",
                  usage: { input_tokens: 4, output_tokens: 3 },
                },
              },
            ]);
      },
    );
    const execute = vi.fn(async () => "Okami SDK");
    const adapter = new ResponsesTransportAdapter({
      kind: "codex",
      transportId: "openai-api",
      baseUrl: "https://api.openai.com/v1",
      credentialReference: "OPENAI_API_KEY",
      credential: { get: async () => "okami-owned-key" },
      taskIdForRun: async () => taskId,
      fetch: fetchRequest,
      tools: {
        definitions: () => [
          {
            type: "function",
            name: "read_file",
            parameters: { type: "object" },
          },
        ],
        prepare: vi.fn(async () => ({
          name: "read_file",
          arguments: { path: "README.md" },
          authorization: { decision: "allow" as const },
          capability: "workspace.read" as const,
          resource: "/workspace/README.md",
          execute,
        })),
      },
      createEventId: (sequence) => `event-${sequence}`,
      clock: () => new Date("2026-07-24T10:00:00.000Z"),
    });
    const session = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "gpt-5",
    });

    const events = await collect(
      (
        await adapter.sendTurn({
          laneId,
          runId,
          nativeSessionId: session.nativeSessionId,
          input: "Read it",
        })
      ).events,
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(bodies[0]).toMatchObject({
      input: "Read it",
      tools: [expect.objectContaining({ name: "read_file" })],
    });
    expect(bodies[1]).toMatchObject({
      previous_response_id: "response-tools",
      input: [
        {
          type: "function_call_output",
          call_id: "call-read",
          output: "Okami SDK",
        },
      ],
    });
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "tool_call_started",
        "tool_call_completed",
        "message_completed",
        "run_completed",
      ]),
    );
  });

  it("is unavailable without an Okami-owned credential and never calls fetch", async () => {
    const fetchRequest = vi.fn();
    const adapter = createAdapter("grok", fetchRequest, null);

    await expect(adapter.detect()).resolves.toMatchObject({
      available: false,
      protocolSupported: true,
      version: "responses-v1",
      detail:
        "XAI_API_KEY or its subscription endpoint is not configured in OkamiCode",
    });
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("aborts the request owned by a cancelled run", async () => {
    const captured: { signal: AbortSignal | null } = { signal: null };
    const fetchRequest = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        captured.signal = init?.signal ?? null;
        return sseResponse([]);
      },
    );
    const adapter = createAdapter("grok", fetchRequest);
    const session = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "grok-4.3",
    });
    const handle = await adapter.sendTurn({
      laneId,
      runId,
      nativeSessionId: session.nativeSessionId,
      input: "wait",
    });

    await adapter.cancel(runId);
    const events = await collect(handle.events);

    expect(captured.signal?.aborted).toBe(true);
    expect(events.at(-1)?.kind).toBe("run_cancelled");
  });
});

function createAdapter(
  kind: RuntimeKind,
  fetchRequest: typeof fetch,
  credential: string | null = "okami-owned-key",
): ResponsesTransportAdapter {
  return new ResponsesTransportAdapter({
    kind,
    transportId: kind === "grok" ? "xai-api" : "openai-api",
    baseUrl:
      kind === "grok" ? "https://api.x.ai/v1" : "https://api.openai.com/v1",
    credentialReference: kind === "grok" ? "XAI_API_KEY" : "OPENAI_API_KEY",
    credential: { get: async () => credential },
    taskIdForRun: async () => taskId,
    fetch: fetchRequest,
    createEventId: (sequence) => `event-${sequence}`,
    clock: () => new Date("2026-07-24T10:00:00.000Z"),
  });
}

function sseResponse(events: unknown[]): Response {
  const payload = `${events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("")}data: [DONE]\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
