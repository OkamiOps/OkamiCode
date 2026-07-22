import { spawn as nativeSpawnPty } from "node-pty";

interface UsagePty {
  kill(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal: number }) => void): {
    dispose(): void;
  };
  write(value: string): void;
}

export type SpawnNativeUsagePty = (
  command: string,
  args: string[],
  options: {
    cols: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: string;
    rows: number;
  },
) => UsagePty;

export interface NativeUsageScreenResult {
  exitCode: number;
  output: string;
}

export function runNativeUsageScreen(options: {
  args?: string[];
  command: string;
  completion: RegExp;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  ready: RegExp;
  slashCommand: string;
  submitCount?: number;
  spawnPty?: SpawnNativeUsagePty;
  timeoutMs?: number;
}): Promise<NativeUsageScreenResult> {
  return new Promise((resolve) => {
    const terminal = (options.spawnPty ?? nativeSpawnPty)(
      options.command,
      options.args ?? [],
      {
        cols: 120,
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
        name: "xterm-256color",
        rows: 46,
      },
    );
    let output = "";
    let asked = false;
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    const hardTimer = setTimeout(() => finish(0), options.timeoutMs ?? 30_000);

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      try {
        terminal.kill();
      } catch {
        // The PTY may already be closed after its final redraw.
      }
      resolve({ exitCode, output });
    };

    terminal.onData((data) => {
      output += data;
      const compact = compactScreen(output);
      if (!asked && options.ready.test(compact)) {
        asked = true;
        setTimeout(() => {
          terminal.write(`${options.slashCommand}\r`);
          // Cursor first opens slash-command completion and requires a second
          // Enter to run the highlighted command. Other CLIs execute on one.
          if ((options.submitCount ?? 1) > 1) {
            setTimeout(() => terminal.write("\r"), 350);
          }
        }, 700);
      }
      if (asked && options.completion.test(compact)) {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(0), 1_200);
      }
    });
    terminal.onExit(({ exitCode }) => finish(exitCode));
  });
}

export function compactScreen(value: string): string {
  // Presentational CLIs redraw cells with cursor movement. Removing terminal
  // controls and whitespace makes stable labels parseable without pretending
  // the screen is a structured API.
  let clean = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code !== 27 && code !== 155) {
      if (code !== 13) clean += value[index];
      continue;
    }
    if (code === 27 && value[index + 1] === "]") {
      index += 2;
      while (index < value.length && value.charCodeAt(index) !== 7) index++;
      continue;
    }
    if (code === 27 && value[index + 1] === "[") index++;
    while (index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      index++;
      if (next >= 64 && next <= 126) break;
    }
  }
  return clean.replace(/\s+/gu, "");
}
