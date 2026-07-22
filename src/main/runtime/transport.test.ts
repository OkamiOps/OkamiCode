import { describe, expect, it } from "vitest";
import { once } from "node:events";
import path from "node:path";
import { JsonlProcess } from "./transport";

const fixture = path.resolve("tests/fixtures/runtime/jsonl-echo.mjs");

describe("JsonlProcess", () => {
  it("streams unicode lines and cancels without orphaning", async () => {
    const proc = await JsonlProcess.spawn(process.execPath, [fixture]);
    await proc.send({ id: 1, text: "ação 狼" });
    const echoed = await proc.next();
    expect(echoed?.text).toBe("ação 狼");
    await proc.cancel();
    const exit = await proc.wait();
    expect(exit.successOrCancelled).toBe(true);
  });

  it("keeps stdout noise and redacted stderr out of JSON envelopes", async () => {
    const stdoutSecret = "stdout-private-value";
    const stderrSecret = "stderr-private-value";
    const script = [
      `process.stdout.write("token=${stdoutSecret}\\n")`,
      'process.stdout.write("{\\"ok\\":true}\\n")',
      `process.stderr.write("Authorization: Bearer ${stderrSecret}\\n")`,
      'process.once("SIGTERM", () => process.exit(0))',
      "setInterval(() => {}, 1000)",
    ].join(";");
    const proc = await JsonlProcess.spawn(process.execPath, ["-e", script]);

    try {
      const stdoutDiagnostic = once(proc.diagnostics, "data");
      const stderrDiagnostic = once(proc.stderrDiagnostics, "data");
      const envelope = await proc.next();
      const [stdoutChunk] = await stdoutDiagnostic;
      const [stderrChunk] = await stderrDiagnostic;

      expect(envelope).toEqual({ ok: true });
      expect(String(stdoutChunk).includes(stdoutSecret)).toBe(false);
      expect(String(stderrChunk).includes(stderrSecret)).toBe(false);
    } finally {
      await proc.cancel();
      await proc.wait();
    }
  });

  it("can close stdin for one-shot CLIs that wait for EOF", async () => {
    const script = [
      'let input = ""',
      'process.stdin.on("data", (chunk) => { input += chunk })',
      'process.stdin.on("end", () => console.log(JSON.stringify({ input })))',
    ].join(";");
    const proc = await JsonlProcess.spawn(process.execPath, ["-e", script], {
      closeStdin: true,
    });

    expect(await proc.next()).toEqual({ input: "" });
    await expect(proc.wait()).resolves.toEqual({ successOrCancelled: true });
  });
});
