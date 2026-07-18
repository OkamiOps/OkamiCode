import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export const MAX_BUFFERED = 256;

export interface JsonlProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessWaitResult {
  successOrCancelled: boolean;
}

type JsonEnvelope = Record<string, unknown>;
type Waiter<T> = (value: T | undefined) => void;

export class JsonlProcess<T = JsonEnvelope> {
  readonly diagnostics: Readable;
  readonly stderrDiagnostics: Readable;

  private readonly queue: T[] = [];
  private readonly waiters: Array<Waiter<T>> = [];
  private readonly stdoutDiagnostics = new PassThrough();
  private readonly stderrDiagnosticWriter = new PassThrough();
  private readonly decoder = new StringDecoder("utf8");
  private readonly completion: Promise<ProcessWaitResult>;
  private resolveCompletion!: (result: ProcessWaitResult) => void;
  private stdoutBuffer = "";
  private stdoutPaused = false;
  private stdoutEnded = false;
  private stdoutComplete = false;
  private cancelRequested = false;
  private exited = false;
  private closed = false;
  private killTimer: NodeJS.Timeout | undefined;

  static async spawn<T = JsonEnvelope>(
    command: string,
    args: string[],
    options?: JsonlProcessOptions,
  ): Promise<JsonlProcess<T>> {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options?.cwd,
      env: options?.env,
    });
    const process = new JsonlProcess<T>(child);

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        child.off("spawn", onSpawn);
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });

    return process;
  }

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.diagnostics = this.stdoutDiagnostics;
    this.stderrDiagnostics = this.stderrDiagnosticWriter;
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += this.decoder.write(chunk);
      this.drainStdoutBuffer();
    });
    child.stdout.once("end", () => this.finishStdout());

    const stderrLines = readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity,
    });
    stderrLines.on("line", (line) => {
      writeDiagnostic(this.stderrDiagnosticWriter, line);
    });
    stderrLines.once("close", () => this.stderrDiagnosticWriter.end());

    child.stdin.on("error", (error) => {
      writeDiagnostic(this.stderrDiagnosticWriter, error.message);
    });
    child.on("error", (error) => {
      writeDiagnostic(this.stderrDiagnosticWriter, error.message);
    });
    child.once("exit", () => {
      this.exited = true;
      this.clearKillTimer();
    });
    child.once("close", (code, signal) => {
      this.closed = true;
      this.exited = true;
      this.clearKillTimer();
      this.finishStdout();
      this.resolveCompletion({
        successOrCancelled:
          code === 0 || (this.cancelRequested && signal === "SIGTERM"),
      });
    });
  }

  get pid(): number {
    if (this.child.pid === undefined) throw new Error("Process has no PID");
    return this.child.pid;
  }

  get isRunning(): boolean {
    return !this.exited && !this.closed;
  }

  async send(message: unknown): Promise<void> {
    const serialized = JSON.stringify(message);
    if (serialized === undefined)
      throw new TypeError("Message is not JSON serializable");

    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${serialized}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  next(): Promise<T | undefined> {
    const value = this.queue.shift();
    if (value !== undefined) {
      this.resumeStdoutAfterDrain();
      return Promise.resolve(value);
    }
    if (this.stdoutComplete) return Promise.resolve(undefined);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async cancel(): Promise<void> {
    if (this.cancelRequested || this.closed) return;
    this.cancelRequested = true;
    this.child.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      if (this.isRunning) this.child.kill("SIGKILL");
    }, 2000);
  }

  wait(): Promise<ProcessWaitResult> {
    return this.completion;
  }

  private drainStdoutBuffer(): void {
    while (this.queue.length < MAX_BUFFERED || this.waiters.length > 0) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) {
        if (!this.stdoutEnded || this.stdoutBuffer.length === 0) break;
        const finalLine = this.stdoutBuffer;
        this.stdoutBuffer = "";
        this.acceptLine(finalLine);
        continue;
      }

      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      this.acceptLine(line);
    }

    if (this.queue.length >= MAX_BUFFERED) this.pauseStdout();
    if (this.stdoutEnded && this.stdoutBuffer.length === 0)
      this.completeStdout();
  }

  private acceptLine(line: string): void {
    const parsed = safeParse(line);
    if (!parsed.ok) {
      writeDiagnostic(this.stdoutDiagnostics, line);
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) waiter(parsed.value as T);
    else this.queue.push(parsed.value as T);
  }

  private pauseStdout(): void {
    if (this.stdoutPaused) return;
    this.stdoutPaused = true;
    this.child.stdout.pause();
  }

  private resumeStdoutAfterDrain(): void {
    if (!this.stdoutPaused || this.queue.length >= MAX_BUFFERED) return;
    this.stdoutPaused = false;
    this.drainStdoutBuffer();
    if (!this.stdoutPaused && !this.stdoutEnded) this.child.stdout.resume();
  }

  private finishStdout(): void {
    if (this.stdoutEnded) return;
    this.stdoutEnded = true;
    this.stdoutBuffer += this.decoder.end();
    this.drainStdoutBuffer();
  }

  private completeStdout(): void {
    if (this.stdoutComplete) return;
    this.stdoutComplete = true;
    this.stdoutDiagnostics.end();
    for (const waiter of this.waiters.splice(0)) waiter(undefined);
  }

  private clearKillTimer(): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    this.killTimer = undefined;
  }
}

function safeParse(line: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}

function writeDiagnostic(stream: PassThrough, message: string): void {
  if (!stream.writableEnded) stream.write(`${redactDiagnostic(message)}\n`);
}

function redactDiagnostic(message: string): string {
  return message
    .replace(
      /((?:"?(?:api[_-]?key|authorization|cookie|password|secret|token)"?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:sk-(?:ant-)?|gh[pousr]_)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}
