import { describe, expect, it } from "vitest";
import type { DeltaPackage } from "./delta";
import { ContextCompiler } from "./context-compiler";

function delta(eventCount: number): DeltaPackage {
  return {
    schemaVersion: 1,
    taskId: "task-1",
    fromSequenceExclusive: 2,
    toSequenceInclusive: eventCount + 2,
    objective: "Entregar o OkamiCode sem perder o trabalho do usuário",
    constraints: ["Não executar chamadas pagas", "Preservar o worktree"],
    decisions: ["OpenCode entra pelo protocolo ACP"],
    git: {
      branch: "codex/okami-sprints-0-7",
      dirtyFiles: ["src/main/runtime/registry.ts"],
    },
    artifacts: ["artifact://backup/verified"],
    events: Array.from({ length: eventCount }, (_, index) => ({
      sequence: index + 3,
      kind: "message_completed",
      summary: `Evento ${index + 1}: ${"detalhe ".repeat(20)}`,
    })),
  };
}

describe("ContextCompiler", () => {
  it("keeps authoritative state and only the newest events inside the budget", () => {
    const result = new ContextCompiler().compile(delta(30), {
      maxInputTokens: 420,
      reserveForReplyTokens: 120,
    });

    expect(result.content).toContain(
      "Entregar o OkamiCode sem perder o trabalho do usuário",
    );
    expect(result.content).toContain("Não executar chamadas pagas");
    expect(result.content).toContain("OpenCode entra pelo protocolo ACP");
    expect(result.content).toContain("codex/okami-sprints-0-7");
    expect(result.content).toContain("Evento 30");
    expect(result.content).not.toContain("Evento 1:");
    expect(result.estimatedTokens).toBeLessThanOrEqual(300);
    expect(result.omittedEvents).toBeGreaterThan(0);
    expect(result.strategy).toBe("deterministic_delta");
    expect(result.sourceEstimatedTokens).toBeGreaterThan(
      result.estimatedTokens,
    );
    expect(result.savedEstimatedTokens).toBe(
      result.sourceEstimatedTokens - result.estimatedTokens,
    );
  });

  it("does not spend model tokens and produces the same fingerprint for the same delta", () => {
    const compiler = new ContextCompiler();
    const first = compiler.compile(delta(2), {
      maxInputTokens: 2_000,
      reserveForReplyTokens: 500,
    });
    const second = compiler.compile(delta(2), {
      maxInputTokens: 2_000,
      reserveForReplyTokens: 500,
    });

    expect(first.modelCalls).toBe(0);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.omittedEvents).toBe(0);
  });
});
