import { describe, expect, it } from "vitest";
import { connectAcpProcess } from "./connection";

describe("connectAcpProcess", () => {
  it("reports sanitized process diagnostics when ACP closes during initialize", async () => {
    const secret = "stderr-private-value";
    const connection = await connectAcpProcess({
      command: process.execPath,
      args: [
        "-e",
        [
          'process.stderr.write("Unknown: FileSystem.open (/blocked/opencode.log)\\n")',
          `process.stderr.write("Authorization: Bearer ${secret}\\n")`,
          "process.exit(1)",
        ].join(";"),
      ],
      cwd: process.cwd(),
      env: { ...process.env },
      handlers: {
        requestPermission: async () => ({
          outcome: { outcome: "cancelled" },
        }),
        sessionUpdate: async () => {},
      },
    });

    const error = await connection
      .initialize()
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /FileSystem\.open \(\/blocked\/opencode\.log\)/u,
    );
    expect((error as Error).message).not.toContain(secret);
  });
});
