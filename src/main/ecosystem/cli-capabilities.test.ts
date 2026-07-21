import { expect, it, vi } from "vitest";
import {
  createCliCapabilityDetector,
  executeProbe,
  localBinaryCandidates,
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
      role: "runtime",
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
      cursor: "/bin/cursor-agent",
      agy: "/bin/agy",
    },
    {
      "--version": "AGY 1.2.3\n",
      "--help": [
        "Options:",
        "  -p, --print",
        "  --output-format <format> (stream-json)",
        "  --stream-partial-output",
        "  --resume <chatId>",
        "  --model <model>",
        "  --mode <mode>",
        "  --auto-review",
        "  --sandbox <mode>",
        "Commands:",
        "  create-chat",
        "  mcp",
        "  plugins",
        "  git",
        "  worktrees",
      ].join("\n"),
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
        binaryPath: "/bin/cursor-agent",
        role: "runtime",
        integrationStatus: "ready",
        capabilities: [
          "sessions",
          "models",
          "sandbox",
          "mcp",
          "git",
          "worktrees",
          "structured_output",
          "plugins",
        ],
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
  expect(injected.execute).toHaveBeenCalledWith("/bin/cursor-agent", [
    "--version",
  ]);
  expect(injected.execute).toHaveBeenCalledWith("/bin/cursor-agent", [
    "--help",
  ]);
});

it("keeps a partial Cursor protocol honest while reporting only proven capabilities", async () => {
  const injected = dependencies(
    { cursor: "/bin/cursor-agent" },
    {
      "--version": "2026.07.01\n",
      "--help": [
        "Options:",
        "  -p, --print",
        "  --output-format <format> (stream-json)",
        "  --resume <chatId>",
        "  --model <model>",
        "Commands:",
        "  create-chat",
        "  mcp",
      ].join("\n"),
    },
  );

  const clients = await createCliCapabilityDetector(injected)();

  expect(clients.find((client) => client.client === "cursor")).toMatchObject({
    role: "launcher",
    integrationStatus: "needs_adapter",
    detail: expect.stringMatching(/protocolo.*n.o.*comprovado/iu),
    capabilities: ["sessions", "models", "mcp", "structured_output"],
  });
});

it("does not infer Cursor browser, subagents, or human approvals without help evidence", async () => {
  const injected = dependencies(
    { cursor: "/bin/cursor-agent" },
    {
      "--help": [
        "-p, --print",
        "--output-format stream-json",
        "--stream-partial-output",
        "--resume",
        "--mode plan",
        "--auto-review",
        "--sandbox enabled",
        "create-chat",
      ].join("\n"),
    },
  );

  const cursor = (await createCliCapabilityDetector(injected)()).find(
    (client) => client.client === "cursor",
  );

  expect(cursor).toMatchObject({
    role: "runtime",
    integrationStatus: "ready",
    capabilities: ["sessions", "sandbox", "structured_output"],
  });
  expect(cursor?.capabilities).not.toEqual(
    expect.arrayContaining(["browser", "subagents", "approvals"]),
  );
});

it("locates Cursor through cursor-agent candidates without treating the GUI launcher as the CLI", () => {
  const candidates = localBinaryCandidates("cursor");

  expect(candidates).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\.local\/bin\/cursor-agent$/u),
    ]),
  );
  expect(candidates.every((candidate) => !candidate.endsWith("/cursor"))).toBe(
    true,
  );
});

it("preserves useful stdout and stderr when a harmless probe exits non-zero", async () => {
  await expect(
    executeProbe(process.execPath, [
      "-e",
      "process.stdout.write('probe stdout'); process.stderr.write('probe stderr'); process.exit(7)",
    ]),
  ).resolves.toBe("probe stdout\nprobe stderr");
});
