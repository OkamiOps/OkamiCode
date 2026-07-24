import path from "node:path";
import type { CliClient } from "../ecosystem/cli-capabilities";

type LocateCli = (client: CliClient) => string | null;

const FALLBACKS = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor-agent",
  agy: "agy",
  grok: "grok",
  minimax: "mmx",
  mimo: "mimo",
  opencode: "opencode",
} as const satisfies Record<CliClient, string>;

export function resolveRuntimeCommands(
  locate: LocateCli,
  managed: Partial<Pick<Record<CliClient, string>, "codex" | "grok">> = {},
) {
  return Object.fromEntries(
    (Object.keys(FALLBACKS) as CliClient[]).map((client) => [
      client,
      managed[client as "codex" | "grok"] ??
        locate(client) ??
        FALLBACKS[client],
    ]),
  ) as Record<CliClient, string>;
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
