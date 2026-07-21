export interface MimoArgsOptions {
  prompt: string;
  cwd: string;
  model?: string;
  sessionId?: string;
  effort?: string;
}

export function mimoArgs(options: MimoArgsOptions): string[] {
  return [
    "run",
    "--format",
    "json",
    "--dir",
    options.cwd,
    ...(options.model && options.model !== "default"
      ? ["--model", options.model]
      : []),
    ...(options.sessionId ? ["--session", options.sessionId] : []),
    ...(options.effort ? ["--variant", options.effort] : []),
    options.prompt,
  ];
}
