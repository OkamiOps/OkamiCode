import path from "node:path";
import type { ManagedRuntimeCommands } from "./managed-runtime";

type LocateClaude = (client: "claude") => string | null;

export function resolveRuntimeCommands(
  locate: LocateClaude,
  managed: ManagedRuntimeCommands,
) {
  return {
    claude: locate("claude") ?? "claude",
    ...managed,
  };
}

export function executableEnvironment(
  command: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  if (!path.isAbsolute(command)) return environment;
  const commandDirectory = path.dirname(command);
  const entries = (environment.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  return {
    ...environment,
    PATH: [
      commandDirectory,
      ...entries.filter((entry) => entry !== commandDirectory),
    ].join(path.delimiter),
  };
}
