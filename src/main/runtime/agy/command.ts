import path from "node:path";

export interface AgyLauncherArgsOptions {
  workspacePath: string;
  conversationId?: string;
  model?: string;
  agent?: string;
  permissionMode?: string;
}

/**
 * Builds the safe, interactive AGY launcher invocation. Prompts are deliberately
 * absent: the companion ingress owns hook capture before a native turn exists.
 */
export function agyLauncherArgs(options: AgyLauncherArgsOptions): string[] {
  if (!path.isAbsolute(options.workspacePath)) {
    throw new Error("AGY workspace must be an absolute path");
  }

  return [
    "--add-dir",
    options.workspacePath,
    ...agyPermissionArgs(options.permissionMode),
    ...(options.conversationId
      ? ["--conversation", options.conversationId]
      : []),
    ...(options.model ? ["--model", options.model] : []),
    ...(options.agent ? ["--agent", options.agent] : []),
  ];
}

function agyPermissionArgs(mode: string | undefined): string[] {
  switch (mode ?? "manual") {
    case "manual":
      return ["--sandbox"];
    case "plan":
      return ["--mode", "plan", "--sandbox"];
    case "acceptEdits":
      return ["--mode", "accept-edits", "--sandbox"];
    case "auto":
    case "bypassPermissions":
      throw new Error(`AGY does not safely support permission mode ${mode}`);
    default:
      throw new Error(`Unknown AGY permission mode ${mode}`);
  }
}
