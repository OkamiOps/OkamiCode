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
  omittedMessages: number;
  omittedByCategory: Record<string, number>;
  modelCalls: 0;
  strategy: "deterministic_delta";
  fingerprint: string;
}

type ContextSection =
  "constraints" | "decisions" | "git" | "artifacts" | "conversation" | "events";

interface ContextEntry {
  key: string;
  section: ContextSection;
  category: string;
  line: string;
  priority: number;
  order: number;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

const SECTION_LABELS: Record<ContextSection, string> = {
  constraints: "Restrições",
  decisions: "Decisões",
  git: "Git",
  artifacts: "Artefatos",
  conversation: "Conversa compartilhada",
  events: "Eventos recentes",
};

const SECTION_ORDER: ContextSection[] = [
  "constraints",
  "decisions",
  "git",
  "artifacts",
  "conversation",
  "events",
];

function baseContext(delta: DeltaPackage, availableTokens: number): string {
  const objectiveLimit = Math.max(
    80,
    Math.min(800, Math.floor(availableTokens * 2)),
  );
  return [
    "# Contexto de transferência Okami",
    "",
    "## Objetivo",
    limitAuthoritativeField(delta.objective, objectiveLimit),
  ].join("\n");
}

export class ContextCompiler {
  compile(delta: DeltaPackage, budget: ContextBudget): CompiledContext {
    const availableTokens = Math.max(
      1,
      budget.maxInputTokens - budget.reserveForReplyTokens,
    );
    const base = baseContext(delta, availableTokens);
    const entries = contextEntries(delta);
    const selected: ContextEntry[] = [];

    for (const entry of [...entries].sort(compareEntryPriority)) {
      const candidate = renderContext(base, [...selected, entry]);
      if (estimateTokens(candidate) <= availableTokens) selected.push(entry);
    }

    const content = renderContext(base, selected);
    const estimatedTokens = estimateTokens(content);
    const sourceEstimatedTokens = estimateTokens(JSON.stringify(delta));
    const selectedKeys = new Set(selected.map((entry) => entry.key));
    const omitted = entries.filter((entry) => !selectedKeys.has(entry.key));
    const omittedByCategory = Object.fromEntries(
      [...new Set(entries.map((entry) => entry.category))].map((category) => [
        category,
        omitted.filter((entry) => entry.category === category).length,
      ]),
    );

    return {
      content,
      estimatedTokens,
      sourceEstimatedTokens,
      savedEstimatedTokens: Math.max(
        0,
        sourceEstimatedTokens - estimatedTokens,
      ),
      omittedEvents: omitted.filter((entry) => entry.category === "event")
        .length,
      omittedMessages: omitted.filter(
        (entry) =>
          entry.category === "conversation" || entry.category === "operational",
      ).length,
      omittedByCategory,
      modelCalls: 0,
      strategy: "deterministic_delta",
      fingerprint: createHash("sha256").update(content).digest("hex"),
    };
  }
}

function contextEntries(delta: DeltaPackage): ContextEntry[] {
  const entries: ContextEntry[] = [];
  delta.constraints.forEach((constraint, index) => {
    entries.push({
      key: `constraint:${index}`,
      section: "constraints",
      category: "constraint",
      line: `- ${limitAuthoritativeField(constraint, 400)}`,
      priority: 120,
      order: index,
    });
  });
  delta.decisions.forEach((decision, index) => {
    entries.push({
      key: `decision:${index}`,
      section: "decisions",
      category: "decision",
      line: `- ${limitAuthoritativeField(decision, 400)}`,
      priority: 110,
      order: index,
    });
  });
  if (delta.git) {
    entries.push({
      key: "git",
      section: "git",
      category: "git",
      line: [
        `- Branch: ${limitAuthoritativeField(delta.git.branch, 240)}`,
        `- Arquivos alterados: ${
          delta.git.dirtyFiles
            .slice(0, 20)
            .map((file) => limitAuthoritativeField(file, 240))
            .join(", ") || "nenhum"
        }`,
      ].join("\n"),
      priority: 100,
      order: 0,
    });
  }
  delta.artifacts.forEach((artifact, index) => {
    entries.push({
      key: `artifact:${index}`,
      section: "artifacts",
      category: "artifact",
      line: `- ${limitAuthoritativeField(artifact, 400)}`,
      priority: 70,
      order: index,
    });
  });
  const latestConversationStart = Math.max(0, delta.conversation.length - 4);
  delta.conversation.forEach((message, index) => {
    const operational = message.role === "context";
    const contextKind = message.contextKind ?? "";
    const priority = operational
      ? contextKind === "run_failed" || contextKind === "approval_resolved"
        ? 80
        : 75
      : index >= latestConversationStart
        ? 90
        : 40;
    entries.push({
      key: `conversation:${message.sequence}:${index}`,
      section: "conversation",
      category: operational ? "operational" : "conversation",
      line: conversationLine(message),
      priority,
      order: message.sequence,
    });
  });
  delta.events.forEach((event, index) => {
    const priority =
      event.kind === "run_failed" || event.kind === "approval_resolved"
        ? 65
        : event.kind === "tool_call_completed"
          ? 60
          : 50;
    entries.push({
      key: `event:${event.sequence}:${index}`,
      section: "events",
      category: "event",
      line: `- [${event.sequence}] ${event.kind}: ${event.summary}`,
      priority,
      order: event.sequence,
    });
  });
  return entries;
}

function conversationLine(
  message: DeltaPackage["conversation"][number],
): string {
  if (message.role === "user") return `- Você: ${message.body}`;
  if (message.role === "context") {
    return `- Contexto operacional: ${message.body}`;
  }
  const agent = [message.providerLabel, message.model]
    .filter(Boolean)
    .join(" · ");
  return `- ${agent || "Agente"}: ${message.body}`;
}

function renderContext(base: string, entries: ContextEntry[]): string {
  const sections = SECTION_ORDER.flatMap((section) => {
    const lines = entries
      .filter((entry) => entry.section === section)
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.line);
    return lines.length > 0
      ? ["", `## ${SECTION_LABELS[section]}`, ...lines]
      : [];
  });
  return [base, ...sections].join("\n");
}

function compareEntryPriority(left: ContextEntry, right: ContextEntry): number {
  return right.priority - left.priority || right.order - left.order;
}

function limitAuthoritativeField(value: string, maxCharacters: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxCharacters) return normalized;
  const candidate = normalized.slice(0, maxCharacters - 1);
  const boundary = candidate.lastIndexOf(" ");
  const bounded = boundary > 40 ? candidate.slice(0, boundary) : candidate;
  return `${bounded.trim()}…`;
}
