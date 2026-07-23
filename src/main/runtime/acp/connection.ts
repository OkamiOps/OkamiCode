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
import { redactDiagnostic } from "../transport";

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
  let stderrTail = "";
  let exitDetail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail =
      `${stderrTail}${redactDiagnostic(chunk.toString("utf8"))}`.slice(-2_000);
  });
  child.once("exit", (code, signal) => {
    exitDetail = signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`;
  });
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  );
  const connection = new ClientSideConnection(() => options.handlers, stream);
  const withDiagnostics = async <T>(
    operation: string,
    execute: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await execute();
    } catch (error) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const cause = error instanceof Error ? error.message : String(error);
      const diagnostics = stderrTail.trim();
      throw new Error(
        [
          `ACP ${operation} failed: ${cause}`,
          exitDetail,
          diagnostics ? `stderr: ${diagnostics}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        { cause: error },
      );
    }
  };

  return {
    initialize: () =>
      withDiagnostics("initialize", () =>
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
      ),
    newSession: (cwd) =>
      withDiagnostics("new session", () =>
        connection.newSession({ cwd, mcpServers: [] }),
      ),
    resumeSession: (sessionId, cwd) =>
      withDiagnostics("resume session", () =>
        connection.resumeSession({
          sessionId,
          cwd,
          mcpServers: [],
        }),
      ),
    prompt: (sessionId, input) =>
      withDiagnostics("prompt", () =>
        connection.prompt({
          sessionId,
          prompt: [{ type: "text", text: input }],
        }),
      ),
    cancel: (sessionId) =>
      withDiagnostics("cancel", () => connection.cancel({ sessionId })),
    setModel: async (sessionId, modelId) => {
      await withDiagnostics("set model", () =>
        connection.unstable_setSessionModel({ sessionId, modelId }),
      );
    },
    close: () => {
      child.kill();
    },
  };
};
