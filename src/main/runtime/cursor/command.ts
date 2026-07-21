export interface CursorArgsOptions {
  prompt: string;
  model?: string;
  resumeId?: string;
}

export function cursorArgs(options: CursorArgsOptions): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    ...(options.model ? ["--model", options.model] : []),
    ...(options.resumeId ? [`--resume=${options.resumeId}`] : []),
    options.prompt,
  ];
}
