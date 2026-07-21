export interface GrokArgsOptions {
  prompt: string;
  sessionId: string;
  resume: boolean;
  model?: string;
  effort?: string;
  permissionMode?: string;
}

export function grokArgs(options: GrokArgsOptions): string[] {
  return [
    "--single",
    options.prompt,
    "--output-format",
    "streaming-json",
    ...(options.resume
      ? ["--resume", options.sessionId]
      : ["--session-id", options.sessionId]),
    ...(options.model && options.model !== "default"
      ? ["--model", options.model]
      : []),
    ...(options.effort ? ["--reasoning-effort", options.effort] : []),
    ...permissionArgs(options.permissionMode),
  ];
}

function permissionArgs(mode = "manual"): string[] {
  switch (mode) {
    case "manual":
      return ["--permission-mode", "default"];
    case "acceptEdits":
      return ["--permission-mode", "acceptEdits"];
    case "plan":
      return ["--permission-mode", "plan"];
    case "bypassPermissions":
      return ["--permission-mode", "bypassPermissions"];
    case "auto":
      throw new Error("Grok does not expose a verified auto-review mode");
    default:
      throw new Error(`Unknown Grok permission mode ${mode}`);
  }
}
