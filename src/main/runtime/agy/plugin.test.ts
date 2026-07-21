import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgyPluginManager, type AgyPluginExecutor } from "./plugin";

interface Execution {
  command: string;
  args: string[];
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(removeTemporaryDirectory),
  );
});

async function removeTemporaryDirectory(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await removeTemporaryDirectory(entryPath);
    else await unlink(entryPath);
  }
  await rmdir(directory);
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "okami-agy-plugin-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeExecutor(
  executions: Execution[],
  result: { stdout?: string } = {},
): AgyPluginExecutor {
  return async (command, args) => {
    executions.push({ command, args });
    return result;
  };
}

describe("AgyPluginManager", () => {
  it("prepares the exact private, deterministic companion manifest without calling AGY", async () => {
    const directory = await temporaryDirectory();
    const sourceDirectory = path.join(directory, "plugin source");
    const hookScriptPath = path.join(directory, "hooks", "okami's hook.mjs");
    await mkdir(path.dirname(hookScriptPath), { recursive: true });
    await writeFile(hookScriptPath, "#!/usr/bin/env node\n", {
      mode: 0o700,
    });
    const executions: Execution[] = [];
    const manager = new AgyPluginManager({
      command: "agy",
      sourceDirectory,
      hookScriptPath,
      execute: fakeExecutor(executions),
    });

    await manager.prepare();

    expect(executions).toEqual([]);
    await expect(
      readFile(path.join(sourceDirectory, "plugin.json"), "utf8"),
    ).resolves.toBe('{\n  "name": "okami-agy-companion"\n}\n');
    const hooks = JSON.parse(
      await readFile(path.join(sourceDirectory, "hooks.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(hooks).toEqual({
      "okami-agy-companion": {
        PreInvocation: [
          {
            type: "command",
            command: `'${hookScriptPath.replaceAll("'", "'\"'\"'")}' PreInvocation`,
            timeout: 30,
          },
        ],
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `'${hookScriptPath.replaceAll("'", "'\"'\"'")}' PreToolUse`,
                timeout: 30,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "*",
            hooks: [
              {
                type: "command",
                command: `'${hookScriptPath.replaceAll("'", "'\"'\"'")}' PostToolUse`,
                timeout: 30,
              },
            ],
          },
        ],
        Stop: [
          {
            type: "command",
            command: `'${hookScriptPath.replaceAll("'", "'\"'\"'")}' Stop`,
            timeout: 30,
          },
        ],
      },
    });
    expect(
      (await stat(path.join(sourceDirectory, "plugin.json"))).mode & 0o777,
    ).toBe(0o600);
    expect(
      (await stat(path.join(sourceDirectory, "hooks.json"))).mode & 0o777,
    ).toBe(0o600);
  });

  it.each([
    ["other-plugin\\n", "absent"],
    ["okami-agy-companion\\n", "enabled"],
    ["other-plugin\\nokami-agy-companion (disabled)\\n", "disabled"],
  ] as const)(
    "runs only plugin list for %s status without mutating",
    async (stdout, expectedStatus) => {
      const directory = await temporaryDirectory();
      const executions: Execution[] = [];
      const manager = new AgyPluginManager({
        command: "agy",
        sourceDirectory: path.join(directory, "source"),
        hookScriptPath: path.join(directory, "missing-helper.mjs"),
        execute: fakeExecutor(executions, {
          stdout,
        }),
      });

      await expect(manager.status()).resolves.toBe(expectedStatus);
      expect(
        executions.map(({ command, args }) => ({ command, args })),
      ).toEqual([{ command: "agy", args: ["plugin", "list"] }]);
      await expect(stat(path.join(directory, "source"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("runs the install lifecycle in order and only its documented subcommands", async () => {
    const directory = await temporaryDirectory();
    const sourceDirectory = path.join(directory, "source");
    const hookScriptPath = path.join(directory, "okami-agy-hook.mjs");
    await writeFile(hookScriptPath, "#!/usr/bin/env node\n");
    const executions: Execution[] = [];
    const manager = new AgyPluginManager({
      command: "agy",
      sourceDirectory,
      hookScriptPath,
      execute: fakeExecutor(executions),
    });

    await manager.install();
    await manager.disable();
    await manager.uninstall();

    expect(executions.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: "agy", args: ["plugin", "validate", sourceDirectory] },
      { command: "agy", args: ["plugin", "install", sourceDirectory] },
      { command: "agy", args: ["plugin", "enable", "okami-agy-companion"] },
      { command: "agy", args: ["plugin", "disable", "okami-agy-companion"] },
      { command: "agy", args: ["plugin", "uninstall", "okami-agy-companion"] },
    ]);
  });

  it("rejects a relative or missing hook helper and sanitizes executor failures", async () => {
    const directory = await temporaryDirectory();
    const executions: Execution[] = [];
    const nonExecutableHook = path.join(directory, "non-executable-hook.mjs");
    await writeFile(nonExecutableHook, "#!/usr/bin/env node\n", {
      mode: 0o600,
    });
    const relativeHelper = new AgyPluginManager({
      command: "agy",
      sourceDirectory: path.join(directory, "source"),
      hookScriptPath: "bin/okami-agy-hook.mjs",
      execute: fakeExecutor(executions),
    });
    const nonExecutableHelper = new AgyPluginManager({
      command: "agy",
      sourceDirectory: path.join(directory, "non-executable-source"),
      hookScriptPath: nonExecutableHook,
      execute: fakeExecutor(executions),
    });
    const missingHelper = new AgyPluginManager({
      command: "agy",
      sourceDirectory: path.join(directory, "source"),
      hookScriptPath: path.join(directory, "missing-helper.mjs"),
      execute: fakeExecutor(executions),
    });
    const leakingExecutor = new AgyPluginManager({
      command: "agy",
      sourceDirectory: path.join(directory, "source"),
      hookScriptPath: path.join(directory, "missing-helper.mjs"),
      execute: async () => {
        throw new Error(
          "/Users/marcos/.gemini token=do-not-expose stderr=secret",
        );
      },
    });

    await expect(relativeHelper.prepare()).rejects.toThrow(
      "AGY plugin helper must be an absolute path",
    );
    await expect(missingHelper.prepare()).rejects.toThrow(
      "AGY plugin helper is unavailable",
    );
    await expect(nonExecutableHelper.prepare()).rejects.toThrow(
      "AGY plugin helper is not executable",
    );
    try {
      await leakingExecutor.status();
      throw new Error("expected status to fail");
    } catch (error) {
      expect(error).toHaveProperty("message", "AGY plugin status failed");
    }
  });
});
