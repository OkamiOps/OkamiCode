export interface CursorArgsOptions {
  prompt: string;
  model?: string;
  resumeId?: string;
  permissionMode?: string;
}

export function cursorArgs(options: CursorArgsOptions): string[] {
  const permissionArgs = cursorPermissionArgs(options.permissionMode);
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    ...permissionArgs,
    // Trust only suppresses Cursor's separate workspace identity prompt.
    // Execution remains constrained by sandbox/mode and is never force-approved.
    "--trust",
    ...(options.model && options.model !== "default"
      ? ["--model", options.model]
      : []),
    ...(options.resumeId ? [`--resume=${options.resumeId}`] : []),
    options.prompt,
  ];
}

function cursorPermissionArgs(mode: string | undefined): string[] {
  switch (mode ?? "manual") {
    case "manual":
      return ["--sandbox", "enabled"];
    case "plan":
      return ["--mode", "plan", "--sandbox", "enabled"];
    case "auto":
      return ["--auto-review", "--sandbox", "enabled"];
    case "acceptEdits":
    case "bypassPermissions":
      throw new Error(`Cursor does not safely support permission mode ${mode}`);
    default:
      throw new Error(`Unknown Cursor permission mode ${mode}`);
  }
}
