import { BridgeUnhealthyError } from "./chatgpt-backend";

export {
  BridgeUnhealthyError,
  createCodexChatGptBackend,
  type CodexBackendOptions,
} from "./chatgpt-backend";

type JsonRecord = Record<string, unknown>;

export interface ChatGptBackendRequest extends JsonRecord {
  model: string;
  instructions: string;
  input: JsonRecord[];
  tools?: JsonRecord[];
  tool_choice: "auto";
  parallel_tool_calls: boolean;
  reasoning: { effort: string } | null;
  store: false;
  stream: true;
  include: string[];
}

export interface ChatGptStreamEvent extends JsonRecord {
  type: string;
}

export interface ChatGptBackend {
  stream(request: ChatGptBackendRequest): AsyncIterable<ChatGptStreamEvent>;
}

export interface ChatGptBridgeContext {
  effort?: string;
}

export interface ChatGptBridge {
  handleMessages(
    request: unknown,
    context?: ChatGptBridgeContext,
  ): AsyncIterable<string>;
}

export interface ChatGptBridgeOptions {
  // Backend model billed to the ChatGPT subscription. The Claude harness sends
  // Anthropic model ids, which the ChatGPT backend rejects with a 400, so the
  // profile's configured model always wins.
  model: string;
}

export function createChatGptBridge(
  backend: ChatGptBackend,
  options: ChatGptBridgeOptions,
): ChatGptBridge {
  return {
    async *handleMessages(request, context) {
      try {
        const translated = translateAnthropicRequest(
          request,
          options.model,
          context?.effort,
        );
        const upstream = backend.stream(translated)[Symbol.asyncIterator]();
        const first = await upstream.next();
        yield sse("message_start", {
          type: "message_start",
          message: {
            id: `msg_${crypto.randomUUID()}`,
            type: "message",
            role: "assistant",
            content: [],
            model: translated.model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
        yield* translateChatGptStream(prepend(first, upstream));
      } catch (error) {
        if (error instanceof BridgeUnhealthyError) throw error;
        throw new BridgeUnhealthyError("ChatGPT bridge is unhealthy", {
          cause: error,
        });
      }
    },
  };
}

async function* prepend<T>(
  first: IteratorResult<T>,
  rest: AsyncIterator<T>,
): AsyncIterable<T> {
  if (!first.done) yield first.value;
  for (;;) {
    const next = await rest.next();
    if (next.done) return;
    yield next.value;
  }
}

function translateAnthropicRequest(
  value: unknown,
  backendModel: string,
  effort?: string,
): ChatGptBackendRequest {
  const request = record(value);
  if (!request || typeof request.model !== "string") {
    throw new Error("Anthropic request is missing model");
  }
  const tools = array(request.tools).map((entry) => {
    const tool = requiredRecord(entry, "tool");
    return {
      type: "function",
      name: requiredString(tool.name, "tool.name"),
      description: typeof tool.description === "string" ? tool.description : "",
      parameters: record(tool.input_schema) ?? {},
    };
  });
  return {
    model: backendModel,
    instructions: anthropicText(request.system),
    input: translateMessages(array(request.messages)),
    ...(tools.length > 0 ? { tools } : {}),
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: effort ? { effort } : null,
    store: false,
    stream: true,
    include: [],
  };
}

function translateMessages(messages: unknown[]): JsonRecord[] {
  const input: JsonRecord[] = [];
  for (const entry of messages) {
    const message = requiredRecord(entry, "message");
    const rawRole = requiredString(message.role, "message.role");
    // The ChatGPT Codex backend rejects system-role input items ("System messages
    // are not allowed"); the top-level system prompt already travels as
    // `instructions`, so inline system context degrades to a user item.
    const role = rawRole === "system" ? "user" : rawRole;
    const content =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : array(message.content);
    let text: string[] = [];
    const flushText = () => {
      if (text.length === 0) return;
      input.push({
        type: "message",
        role,
        content: [
          {
            type: role === "assistant" ? "output_text" : "input_text",
            text: text.join("\n"),
          },
        ],
      });
      text = [];
    };
    for (const blockValue of content) {
      const block = requiredRecord(blockValue, "content block");
      if (block.type === "text" && typeof block.text === "string") {
        text.push(block.text);
      } else if (block.type === "tool_use") {
        flushText();
        input.push({
          type: "function_call",
          call_id: requiredString(block.id, "tool_use.id"),
          name: requiredString(block.name, "tool_use.name"),
          arguments: JSON.stringify(record(block.input) ?? {}),
        });
      } else if (block.type === "tool_result") {
        flushText();
        input.push({
          type: "function_call_output",
          call_id: requiredString(block.tool_use_id, "tool_result.tool_use_id"),
          output: anthropicText(block.content),
        });
      }
    }
    flushText();
  }
  return input;
}

async function* translateChatGptStream(
  stream: AsyncIterable<ChatGptStreamEvent>,
): AsyncIterable<string> {
  const blocks = new Map<number, { index: number; stopped: boolean }>();
  let nextIndex = 0;
  let usedTool = false;
  let outputTokens = 0;
  const ensureTextBlock = (outputIndex: number): string | undefined => {
    if (blocks.has(outputIndex)) return undefined;
    const index = nextIndex++;
    blocks.set(outputIndex, { index, stopped: false });
    return sse("content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "" },
    });
  };

  for await (const event of stream) {
    const outputIndex = number(event.output_index) ?? 0;
    if (event.type === "response.output_text.delta") {
      const start = ensureTextBlock(outputIndex);
      if (start) yield start;
      const block = blocks.get(outputIndex)!;
      yield sse("content_block_delta", {
        type: "content_block_delta",
        index: block.index,
        delta: { type: "text_delta", text: string(event.delta) },
      });
    } else if (event.type === "response.output_item.added") {
      const item = record(event.item);
      if (item?.type === "function_call") {
        usedTool = true;
        const index = nextIndex++;
        blocks.set(outputIndex, { index, stopped: false });
        yield sse("content_block_start", {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: string(item.call_id) || string(item.id),
            name: string(item.name),
            input: {},
          },
        });
      }
    } else if (event.type === "response.function_call_arguments.delta") {
      const block = blocks.get(outputIndex);
      if (block) {
        yield sse("content_block_delta", {
          type: "content_block_delta",
          index: block.index,
          delta: {
            type: "input_json_delta",
            partial_json: string(event.delta),
          },
        });
      }
    } else if (
      event.type === "response.output_text.done" ||
      event.type === "response.output_item.done"
    ) {
      const stopped = stopBlock(blocks, outputIndex);
      if (stopped) yield stopped;
    } else if (event.type === "response.completed") {
      const usage = record(record(event.response)?.usage);
      outputTokens = number(usage?.output_tokens) ?? 0;
    } else if (event.type === "response.failed" || event.type === "error") {
      throw new Error(`ChatGPT backend stream failed: ${event.type}`);
    }
  }
  for (const [outputIndex] of blocks) {
    const stopped = stopBlock(blocks, outputIndex);
    if (stopped) yield stopped;
  }
  yield sse("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: usedTool ? "tool_use" : "end_turn",
      stop_sequence: null,
    },
    usage: { output_tokens: outputTokens },
  });
  yield sse("message_stop", { type: "message_stop" });
}

function stopBlock(
  blocks: Map<number, { index: number; stopped: boolean }>,
  outputIndex: number,
): string | undefined {
  const block = blocks.get(outputIndex);
  if (!block || block.stopped) return undefined;
  block.stopped = true;
  return sse("content_block_stop", {
    type: "content_block_stop",
    index: block.index,
  });
}

function sse(event: string, data: JsonRecord): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function anthropicText(value: unknown): string {
  if (typeof value === "string") return value;
  return array(value)
    .map((entry) => {
      const block = record(entry);
      return typeof block?.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function requiredRecord(value: unknown, label: string): JsonRecord {
  const result = record(value);
  if (!result) throw new Error(`${label} must be an object`);
  return result;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
