import { createHash } from "node:crypto";
import type { DeltaPackage } from "./delta";

export interface ContextBudget {
  maxInputTokens: number;
  reserveForReplyTokens: number;
}

export interface CompiledContext {
  content: string;
  estimatedTokens: number;
  sourceEstimatedTokens: number;
  savedEstimatedTokens: number;
  omittedEvents: number;
  modelCalls: 0;
  strategy: "deterministic_delta";
  fingerprint: string;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function bulletList(values: string[], emptyLabel = "Nenhum"): string {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${emptyLabel}`;
}

function authoritativeContext(delta: DeltaPackage): string {
  const git = delta.git
    ? [
        `- Branch: ${delta.git.branch}`,
        `- Arquivos alterados: ${delta.git.dirtyFiles.join(", ") || "nenhum"}`,
      ].join("\n")
    : "- Estado Git não informado";
  const conversation =
    delta.conversation.length > 0
      ? delta.conversation
          .map((message) => {
            if (message.role === "user") return `- Você: ${message.body}`;
            const agent = [message.providerLabel, message.model]
              .filter(Boolean)
              .join(" · ");
            return `- ${agent || "Agente"}: ${message.body}`;
          })
          .join("\n")
      : "- Nenhuma mensagem anterior";

  return [
    "# Contexto de transferência Okami",
    "",
    "## Objetivo",
    delta.objective,
    "",
    "## Restrições",
    bulletList(delta.constraints),
    "",
    "## Decisões",
    bulletList(delta.decisions),
    "",
    "## Git",
    git,
    "",
    "## Artefatos",
    bulletList(delta.artifacts),
    "",
    "## Conversa compartilhada",
    conversation,
  ].join("\n");
}

export class ContextCompiler {
  compile(delta: DeltaPackage, budget: ContextBudget): CompiledContext {
    const availableTokens = Math.max(
      1,
      budget.maxInputTokens - budget.reserveForReplyTokens,
    );
    const base = authoritativeContext(delta);
    const selected: DeltaPackage["events"] = [];

    for (const event of [...delta.events].reverse()) {
      const candidate = [
        base,
        "",
        "## Eventos recentes",
        ...[event, ...selected].map(
          (item) => `- [${item.sequence}] ${item.kind}: ${item.summary}`,
        ),
      ].join("\n");
      if (estimateTokens(candidate) > availableTokens) break;
      selected.unshift(event);
    }

    const content =
      selected.length > 0
        ? [
            base,
            "",
            "## Eventos recentes",
            ...selected.map(
              (event) =>
                `- [${event.sequence}] ${event.kind}: ${event.summary}`,
            ),
          ].join("\n")
        : base;
    const boundedContent =
      estimateTokens(content) <= availableTokens
        ? content
        : `${content.slice(0, Math.max(0, availableTokens * 4 - 19))}\n[contexto truncado]`;
    const estimatedTokens = estimateTokens(boundedContent);
    const sourceEstimatedTokens = estimateTokens(JSON.stringify(delta));

    return {
      content: boundedContent,
      estimatedTokens,
      sourceEstimatedTokens,
      savedEstimatedTokens: Math.max(
        0,
        sourceEstimatedTokens - estimatedTokens,
      ),
      omittedEvents: delta.events.length - selected.length,
      modelCalls: 0,
      strategy: "deterministic_delta",
      fingerprint: createHash("sha256").update(boundedContent).digest("hex"),
    };
  }
}
