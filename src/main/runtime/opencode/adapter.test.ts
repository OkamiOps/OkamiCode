import { describe, expect, it, vi } from "vitest";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { LaneId, RunId, TaskId } from "../../../shared/ids";
import type {
  AcpClientHandlers,
  AcpConnection,
  AcpConnectionFactory,
} from "../acp/connection";
import { OpenCodeAdapter } from "./adapter";

const laneId = "11111111-1111-4111-8111-111111111111" as LaneId;
const taskId = "22222222-2222-4222-8222-222222222222" as TaskId;
const runId = "33333333-3333-4333-8333-333333333333" as RunId;

describe("OpenCodeAdapter over ACP", () => {
  it("detects ACP, starts a session and projects a fixture turn", async () => {
    let handlers: AcpClientHandlers | undefined;
    const connection: AcpConnection = {
      initialize: vi.fn(async () => ({ protocolVersion: 1 }) as never),
      newSession: vi.fn(async () => ({ sessionId: "oc-session-1" }) as never),
      resumeSession: vi.fn(async () => ({})),
      prompt: vi.fn(async () => {
        await handlers!.sessionUpdate({
          sessionId: "oc-session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Resposta via ACP" },
          },
        } as SessionNotification);
        return { stopReason: "end_turn" as const };
      }),
      cancel: vi.fn(async () => undefined),
      setModel: vi.fn(async () => undefined),
      close: vi.fn(),
    };
    const connect: AcpConnectionFactory = vi.fn(async (options) => {
      handlers = options.handlers;
      return connection;
    });
    const execute = vi.fn(async (_command: string, args: string[]) => ({
      stdout: args.includes("--version")
        ? "1.17.15\n"
        : "opencode acp — start ACP server\n",
    }));
    const adapter = new OpenCodeAdapter({
      taskIdForRun: async () => taskId,
      command: "/nvm/v24/bin/opencode",
      env: { PATH: "/usr/bin:/bin" },
      connect,
      execute,
      createEventId: (sequence) => `event-${sequence}`,
    });

    await expect(adapter.detect()).resolves.toMatchObject({
      available: true,
      protocolSupported: true,
      version: "1.17.15",
    });
    const session = await adapter.start({
      laneId,
      cwd: "/workspace",
      model: "anthropic/claude-sonnet-4",
    });
    expect(session).toMatchObject({
      nativeSessionId: "oc-session-1",
      bindingState: "authoritative",
    });

    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "oc-session-1",
      input: "Teste sem provider real",
    });
    const events = [];
    for await (const event of handle.events) events.push(event);

    expect(events.map((event) => event.kind)).toEqual([
      "message_delta",
      "message_completed",
      "run_completed",
    ]);
    expect(events[0]?.payload).toMatchObject({ text: "Resposta via ACP" });
    expect(connection.setModel).toHaveBeenCalledWith(
      "oc-session-1",
      "anthropic/claude-sonnet-4",
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "/nvm/v24/bin/opencode",
        env: expect.objectContaining({
          PATH: "/nvm/v24/bin:/usr/bin:/bin",
        }),
      }),
    );
  });

  it("bridges ACP permissions to the canonical approval response", async () => {
    let handlers: AcpClientHandlers | undefined;
    let permissionResponse: Promise<RequestPermissionResponse> | undefined;
    const connection: AcpConnection = {
      initialize: vi.fn(async () => ({ protocolVersion: 1 }) as never),
      newSession: vi.fn(async () => ({ sessionId: "oc-session-2" }) as never),
      resumeSession: vi.fn(async () => ({})),
      prompt: vi.fn(async () => {
        permissionResponse = handlers!.requestPermission({
          sessionId: "oc-session-2",
          toolCall: {
            toolCallId: "tool-1",
            title: "Editar arquivo",
            status: "pending",
          },
          options: [
            { optionId: "allow", name: "Permitir", kind: "allow_once" },
            { optionId: "deny", name: "Negar", kind: "reject_once" },
          ],
        } as RequestPermissionRequest);
        await permissionResponse;
        return { stopReason: "end_turn" as const };
      }),
      cancel: vi.fn(async () => undefined),
      setModel: vi.fn(async () => undefined),
      close: vi.fn(),
    };
    const adapter = new OpenCodeAdapter({
      taskIdForRun: async () => taskId,
      connect: async (options) => {
        handlers = options.handlers;
        return connection;
      },
      execute: async () => ({ stdout: "1.17.15 opencode acp" }),
      createEventId: (sequence) => `event-${sequence}`,
    });
    await adapter.start({ laneId, cwd: "/workspace" });
    const handle = await adapter.sendTurn({
      runId,
      laneId,
      nativeSessionId: "oc-session-2",
      input: "Edite",
    });
    const iterator = handle.events[Symbol.asyncIterator]();
    const approval = await iterator.next();
    expect(approval.value?.kind).toBe("approval_requested");

    await adapter.respondToApproval({
      runId,
      approvalId: "tool-1",
      decision: "allow_once",
    });
    await expect(permissionResponse).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "allow" },
    });
  });
});
