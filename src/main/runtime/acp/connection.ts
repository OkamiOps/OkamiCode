import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type InitializeResponse,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ResumeSessionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

export interface AcpClientHandlers {
  requestPermission(
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse>;
  sessionUpdate(notification: SessionNotification): Promise<void>;
}

export interface AcpConnection {
  initialize(): Promise<InitializeResponse>;
  newSession(cwd: string): Promise<NewSessionResponse>;
  resumeSession(sessionId: string, cwd: string): Promise<ResumeSessionResponse>;
  prompt(sessionId: string, input: string): Promise<PromptResponse>;
  cancel(sessionId: string): Promise<void>;
  setModel(sessionId: string, model: string): Promise<void>;
  close(): void;
}

export interface AcpConnectionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  handlers: AcpClientHandlers;
}

export type AcpConnectionFactory = (
  options: AcpConnectionOptions,
) => Promise<AcpConnection>;

export const connectAcpProcess: AcpConnectionFactory = async (options) => {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  if (!child.stdin || !child.stdout) {
    child.kill();
    throw new Error("ACP process did not expose stdio");
  }
  child.stderr?.on("data", () => {
    // ACP reserves stdout for JSON-RPC. Stderr is intentionally not forwarded
    // because provider CLIs may print account or environment details there.
  });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  );
  const connection = new ClientSideConnection(() => options.handlers, stream);

  return {
    initialize: () =>
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      }),
    newSession: (cwd) => connection.newSession({ cwd, mcpServers: [] }),
    resumeSession: (sessionId, cwd) =>
      connection.resumeSession({
        sessionId,
        cwd,
        mcpServers: [],
      }),
    prompt: (sessionId, input) =>
      connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: input }],
      }),
    cancel: (sessionId) => connection.cancel({ sessionId }),
    setModel: async (sessionId, modelId) => {
      await connection.unstable_setSessionModel({ sessionId, modelId });
    },
    close: () => {
      child.kill();
    },
  };
};
