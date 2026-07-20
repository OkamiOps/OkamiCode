import { expect, it, vi } from "vitest";
import {
  createCliCapabilityDetector,
  executeProbe,
  type CliCapabilityDetectorDependencies,
} from "./cli-capabilities";

function dependencies(
  binaries: Record<string, string | null>,
  outputs: Record<string, string> = {},
): CliCapabilityDetectorDependencies {
  return {
    locate: vi.fn((client) => binaries[client] ?? null),
    execute: vi.fn(async (_path, args) => outputs[args.join(" ")] ?? ""),
  };
}

it("reports unavailable clients without probing a missing binary", async () => {
  const injected = dependencies({});

  await expect(createCliCapabilityDetector(injected)()).resolves.toEqual([
    {
      client: "codex",
      label: "Codex",
      binaryPath: null,
      version: null,
      role: "runtime",
      integrationStatus: "unavailable",
      detail: "CLI não encontrado neste computador.",
      capabilities: [],
    },
    {
      client: "claude",
      label: "Claude Code",
      binaryPath: null,
      version: null,
      role: "runtime",
      integrationStatus: "unavailable",
      detail: "CLI não encontrado neste computador.",
      capabilities: [],
    },
    {
      client: "cursor",
      label: "Cursor",
      binaryPath: null,
      version: null,
      role: "launcher",
      integrationStatus: "unavailable",
      detail: "CLI não encontrado neste computador.",
      capabilities: [],
    },
    {
      client: "agy",
      label: "AGY",
      binaryPath: null,
      version: null,
      role: "launcher",
      integrationStatus: "unavailable",
      detail: "CLI não encontrado neste computador.",
      capabilities: [],
    },
  ]);
  expect(injected.execute).not.toHaveBeenCalled();
});

it("derives only the verified local capabilities and statuses from harmless probes", async () => {
  const injected = dependencies(
    {
      codex: "/bin/codex",
      claude: "/bin/claude",
      cursor: "/bin/cursor",
      agy: "/bin/agy",
    },
    {
      "--version": "AGY 1.2.3\n",
      "agent --help": "Cursor agent requires Cursor 0.45.0 or later\n",
    },
  );

  const clients = await createCliCapabilityDetector(injected)();

  expect(clients).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        client: "codex",
        role: "runtime",
        integrationStatus: "ready",
        capabilities: [
          "sessions",
          "models",
          "effort",
          "approvals",
          "sandbox",
          "mcp",
          "hooks",
          "subagents",
          "background",
          "git",
          "worktrees",
          "usage",
          "automations",
          "structured_output",
          "app_server",
        ],
      }),
      expect.objectContaining({
        client: "claude",
        role: "runtime",
        integrationStatus: "ready",
        capabilities: expect.arrayContaining(["browser", "skills"]),
      }),
      expect.objectContaining({
        client: "cursor",
        role: "launcher",
        integrationStatus: "needs_adapter",
        capabilities: ["launcher", "mcp"],
      }),
      expect.objectContaining({
        client: "agy",
        role: "launcher",
        integrationStatus: "needs_adapter",
        capabilities: [
          "sessions",
          "models",
          "approvals",
          "sandbox",
          "subagents",
          "plugins",
        ],
      }),
    ]),
  );
  expect(injected.execute).toHaveBeenCalledWith("/bin/cursor", [
    "agent",
    "--help",
  ]);
});

it("marks Cursor update_required only when its local help explicitly says it is obsolete", async () => {
  const injected = dependencies(
    { cursor: "/bin/cursor" },
    {
      "--version": "Cursor 0.44.0\n",
      "agent --help":
        "Current Cursor version is outdated. Please update Cursor.\n",
    },
  );

  const clients = await createCliCapabilityDetector(injected)();

  expect(clients.find((client) => client.client === "cursor")).toMatchObject({
    integrationStatus: "update_required",
  });
});

it("preserves useful stdout and stderr when a harmless probe exits non-zero", async () => {
  await expect(
    executeProbe(process.execPath, [
      "-e",
      "process.stdout.write('probe stdout'); process.stderr.write('probe stderr'); process.exit(7)",
    ]),
  ).resolves.toBe("probe stdout\nprobe stderr");
});
