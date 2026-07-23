import {
  Activity,
  Check,
  ChevronRight,
  Clock3,
  Coins,
  MessageSquareText,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { canonicalEventSchema } from "../../../shared/contracts/event";
import { MessageMarkdown } from "./MessageMarkdown";
import type { WorkbenchLane } from "./api";
import {
  EventCardRegistry,
  type EventCardEvent,
} from "./events/EventCardRegistry";
import { laneDisplayName } from "./LaneSelector";
import { runtimePresentation as presentRuntime } from "./runtime-presentation";
import { useWorkbenchStore } from "./store";

const TEXT_EVENT_KINDS = new Set(["message_delta", "message_completed"]);

// Lifecycle chatter that Claude/Codex desktop apps do not surface as cards.
const HIDDEN_EVENT_KINDS = new Set([
  "session_started",
  "session_resumed",
  "usage_reported",
  "rate_limit_updated",
  "run_cancelled",
  "run_completed",
]);

function isVisibleEvent(event: EventCardEvent): boolean {
  if (!event.kind) return false;
  if (TEXT_EVENT_KINDS.has(event.kind)) return false;
  if (HIDDEN_EVENT_KINDS.has(event.kind)) return false;
  // Hook plumbing and streamed tool-input chunks are audit detail, not
  // conversation. Updates that carry the full tool input stay: they refresh
  // the started card (folded in mergeToolLifecycle, never shown standalone).
  if (event.kind === "tool_call_updated") {
    return Boolean(event.payload?.toolUseId && event.payload?.input);
  }
  return true;
}

const TOOL_EVENT_KINDS = new Set(["tool_call_started", "tool_call_completed"]);

// A tool call is one card: the completed event folds into its started card
// instead of appearing as a second entry.
function mergeToolLifecycle(events: EventCardEvent[]): EventCardEvent[] {
  const merged: EventCardEvent[] = [];
  const cardByToolUse = new Map<string, number>();
  for (const event of events) {
    const toolUseId =
      typeof event.payload?.toolUseId === "string"
        ? event.payload.toolUseId
        : null;
    if (toolUseId && event.kind === "tool_call_started") {
      cardByToolUse.set(toolUseId, merged.length);
      merged.push(event);
      continue;
    }
    if (toolUseId && event.kind === "tool_call_updated") {
      const index = cardByToolUse.get(toolUseId);
      if (index !== undefined) {
        const started = merged[index];
        merged[index] = {
          ...started,
          payload: { ...started.payload, ...event.payload },
        };
      }
      continue;
    }
    if (toolUseId && event.kind === "tool_call_completed") {
      const index = cardByToolUse.get(toolUseId);
      if (index !== undefined) {
        const started = merged[index];
        merged[index] = {
          ...started,
          kind: "tool_call_completed",
          occurredAt: event.occurredAt ?? started.occurredAt,
          payload: { ...started.payload, ...event.payload },
        };
        continue;
      }
    }
    merged.push(event);
  }
  return merged;
}

interface TimelineUserItem {
  type: "user";
  at: string;
  key: string;
  body: string;
}

interface TimelineAgentItem {
  type: "agent";
  at: string;
  key: string;
  runId: string;
  laneId: string;
  text: string;
}

interface TimelineAgentActivityItem {
  type: "agent_activity";
  at: string;
  key: string;
  runId: string;
  laneId: string;
  messages: TimelineAgentItem[];
}

interface TimelineToolsItem {
  type: "tools";
  at: string;
  key: string;
  runId: string;
  events: EventCardEvent[];
}

interface TimelineCardItem {
  type: "card";
  at: string;
  key: string;
  event: EventCardEvent;
}

type TimelineItem =
  | TimelineUserItem
  | TimelineAgentItem
  | TimelineAgentActivityItem
  | TimelineToolsItem
  | TimelineCardItem;

interface RunTelemetry {
  durationMs: number | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokensAvailable: boolean;
}

function finiteToken(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function telemetryForRun(
  allEvents: EventCardEvent[],
  runId: string,
  startedAt: string,
): RunTelemetry {
  const runEvents = allEvents.filter((event) => event.runId === runId);
  const usageEvent = runEvents
    .filter((event) => event.kind === "usage_reported")
    .at(-1);
  const usage =
    usageEvent?.payload.usage &&
    typeof usageEvent.payload.usage === "object" &&
    !Array.isArray(usageEvent.payload.usage)
      ? (usageEvent.payload.usage as Record<string, unknown>)
      : null;
  const inputTokens = finiteToken(usage?.input_tokens);
  const cacheReadTokens = finiteToken(usage?.cache_read_input_tokens);
  const outputTokens = finiteToken(usage?.output_tokens);
  const tokensAvailable = usage?.available !== false;
  const terminal = runEvents
    .filter((event) =>
      ["run_completed", "run_failed", "run_cancelled"].includes(event.kind),
    )
    .at(-1);
  const start = Date.parse(startedAt);
  const end = terminal?.occurredAt ? Date.parse(terminal.occurredAt) : NaN;
  const durationMs =
    Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? end - start
      : null;
  return {
    durationMs,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    totalTokens: inputTokens + cacheReadTokens + outputTokens,
    tokensAvailable,
  };
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000)
    return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)} mi`;
}

// Claude and Codex summarise a burst of tools in plain language ("Criado um
// arquivo, executado 2 comandos") rather than listing tool names.
const TOOL_PHRASES: Record<string, [string, string]> = {
  Write: ["criado um arquivo", "criados {n} arquivos"],
  Edit: ["editado um arquivo", "editados {n} arquivos"],
  MultiEdit: ["editado um arquivo", "editados {n} arquivos"],
  NotebookEdit: ["editado um notebook", "editados {n} notebooks"],
  Read: ["lido um arquivo", "lidos {n} arquivos"],
  Bash: ["executado um comando", "executados {n} comandos"],
  Glob: ["buscado arquivos", "buscado arquivos"],
  Grep: ["buscado no código", "buscado no código"],
  WebFetch: ["consultada uma página", "consultadas {n} páginas"],
  WebSearch: ["feita uma busca", "feitas {n} buscas"],
  Task: ["acionado um subagente", "acionados {n} subagentes"],
  TodoWrite: ["atualizado o plano", "atualizado o plano"],
};

function toolGroupLabel(events: EventCardEvent[]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    const name =
      typeof event.payload?.toolName === "string"
        ? event.payload.toolName
        : "ferramenta";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const phrases = [...counts.entries()].map(([name, count]) => {
    const phrase = TOOL_PHRASES[name];
    if (!phrase) {
      return count === 1 ? `usado ${name}` : `usado ${name} ${count}×`;
    }
    return count === 1 ? phrase[0] : phrase[1].replace("{n}", String(count));
  });
  const summary = phrases.slice(0, 3).join(", ");
  const sentence = summary.charAt(0).toUpperCase() + summary.slice(1);
  const running = events.some((event) => event.kind === "tool_call_started");
  return running ? `${sentence}…` : sentence;
}

function ToolGroup({
  events,
  telemetry,
}: {
  events: EventCardEvent[];
  telemetry: RunTelemetry | null;
}) {
  const [open, setOpen] = useState(false);
  const running = events.some((event) => event.kind === "tool_call_started");
  const actionCount = events.length;
  const summary = telemetry?.durationMs
    ? `Trabalhou por ${formatDuration(telemetry.durationMs)} · ${actionCount} ${actionCount === 1 ? "ação" : "ações"}`
    : running
      ? `${actionCount} ${actionCount === 1 ? "ação em andamento" : "ações em andamento"}`
      : `${actionCount} ${actionCount === 1 ? "ação realizada" : "ações realizadas"}`;
  return (
    <div className="chat-toolgroup" data-open={open || undefined}>
      <button
        aria-expanded={open}
        className="chat-toolgroup__summary"
        data-running={running || undefined}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Wrench aria-hidden="true" size={12} />
        <span className="chat-toolgroup__copy">
          <strong>{summary}</strong>
          <span>{toolGroupLabel(events)}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="chat-toolgroup__chevron"
          size={12}
        />
      </button>
      {open && (
        <div className="chat-toolgroup__items">
          {events.map((event, index) => (
            <div
              className="chat-toolgroup__item"
              key={event.id ?? `${event.kind}-${index}`}
            >
              <strong>{toolGroupLabel([event])}</strong>
              <EventCardRegistry event={event} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentActivityGroup({
  messages,
  onOpenExternal,
  onOpenUrl,
}: {
  messages: TimelineAgentItem[];
  onOpenExternal?: (url: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = messages.length;
  const label = `${count} ${count === 1 ? "atualização" : "atualizações"} do agente`;

  return (
    <div className="chat-agent-activity" data-open={open || undefined}>
      <button
        aria-expanded={open}
        className="chat-agent-activity__summary"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Activity aria-hidden="true" size={13} />
        <span className="chat-agent-activity__copy">
          <strong>{label}</strong>
          <span>Registro compacto — abra para ver os detalhes</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="chat-agent-activity__chevron"
          size={13}
        />
      </button>
      {open && (
        <div className="chat-agent-activity__items">
          {messages.map((message) => (
            <div className="chat-agent-activity__item" key={message.key}>
              <MessageMarkdown
                onOpenExternal={onOpenExternal}
                onOpenUrl={onOpenUrl}
              >
                {message.text}
              </MessageMarkdown>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function eventForCard(raw: unknown): EventCardEvent {
  const parsed = canonicalEventSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: "invalid_renderer_event", payload: { raw } };
  }
  const record = raw as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    kind:
      typeof record.kind === "string" ? record.kind : "invalid_renderer_event",
    occurredAt:
      typeof record.occurredAt === "string" ? record.occurredAt : undefined,
    laneId: typeof record.laneId === "string" ? record.laneId : undefined,
    runId: typeof record.runId === "string" ? record.runId : undefined,
    payload:
      record.payload &&
      typeof record.payload === "object" &&
      !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : { raw },
  };
}

export function Conversation({
  initialEvents = [],
  isRunning = false,
  lane,
  lanes = [],
  onOpenExternal,
  onOpenUrl,
}: {
  initialEvents?: EventCardEvent[];
  isRunning?: boolean;
  lane: WorkbenchLane | null;
  lanes?: WorkbenchLane[];
  onOpenExternal?: (url: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const sentMessages = useWorkbenchStore((state) => state.sentMessages);
  const streams = useWorkbenchStore((state) => state.streams);
  // Keep lifecycle and usage events internally. They are not conversation
  // cards, but they are the source of truth for elapsed time and token usage.
  const [events, setEvents] = useState<EventCardEvent[]>(() => initialEvents);

  useEffect(() => {
    if (!window.okami?.onEvent) return;
    return window.okami.onEvent((raw) => {
      const event = eventForCard(raw);
      setEvents((current) => {
        if (event.id && current.some((item) => item.id === event.id)) {
          return current;
        }
        return [...current, event].slice(-200);
      });
    });
  }, []);

  // One chronological thread: user turns, per-lane agent replies and tool
  // groups interleave by timestamp instead of stacking by type.
  const items: TimelineItem[] = [];
  for (const message of sentMessages) {
    items.push({
      type: "user",
      at: message.at,
      key: message.id,
      body: message.body,
    });
  }
  const agentsByRun = new Map<string, TimelineAgentItem[]>();
  for (const [key, entry] of Object.entries(streams)) {
    const agent: TimelineAgentItem = {
      type: "agent",
      at: entry.at,
      key,
      runId: key.split(":", 1)[0] ?? key,
      laneId: entry.laneId,
      text: entry.text,
    };
    const group = agentsByRun.get(agent.runId) ?? [];
    group.push(agent);
    agentsByRun.set(agent.runId, group);
  }
  for (const [runId, agents] of agentsByRun) {
    const ordered = agents.sort((left, right) =>
      left.at.localeCompare(right.at),
    );
    const final = ordered.at(-1);
    if (!final) continue;
    const intermediate = ordered.slice(0, -1);
    if (intermediate.length > 0) {
      items.push({
        type: "agent_activity",
        at: intermediate[0]?.at ?? final.at,
        key: `agent-activity:${runId}`,
        runId,
        laneId: final.laneId,
        messages: intermediate,
      });
    }
    items.push(final);
  }
  const visibleEvents = mergeToolLifecycle(events.filter(isVisibleEvent));
  const toolEventsByRun = new Map<string, EventCardEvent[]>();
  for (const event of visibleEvents) {
    const key = event.id ?? `${event.kind}-${event.occurredAt}`;
    if (TOOL_EVENT_KINDS.has(event.kind)) {
      const runId = event.runId ?? "unscoped";
      const group = toolEventsByRun.get(runId) ?? [];
      group.push(event);
      toolEventsByRun.set(runId, group);
      continue;
    }
    items.push({
      type: "card",
      at: event.occurredAt ?? "",
      key,
      event,
    });
  }
  for (const [runId, runEvents] of toolEventsByRun) {
    const first = runEvents[0];
    items.push({
      type: "tools",
      at: first?.occurredAt ?? "",
      key: `tools:${runId}`,
      runId,
      events: runEvents,
    });
  }
  items.sort((left, right) => left.at.localeCompare(right.at));
  const timeline = items;

  // Follow the conversation: stick to the bottom while the user is there,
  // release when they scroll up to read, re-stick when they return.
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    const scroller = bottomRef.current?.closest(".chat-scroll");
    if (!scroller) return;
    const onScroll = () => {
      stickRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  const lastAgent = [...items].reverse().find((item) => item.type === "agent");
  const followSignal = `${timeline.length}:${
    lastAgent?.type === "agent" ? lastAgent.text.length : 0
  }:${sentMessages.length}`;
  const sentCountRef = useRef(sentMessages.length);
  useEffect(() => {
    // Sending a message always jumps to the bottom; streamed growth only
    // follows while the user is already there.
    const sentNow = sentMessages.length;
    const userJustSent = sentNow > sentCountRef.current;
    sentCountRef.current = sentNow;
    if (userJustSent) stickRef.current = true;
    if (stickRef.current) {
      bottomRef.current?.scrollIntoView?.({ block: "end" });
    }
  }, [followSignal, sentMessages.length]);

  const laneById = new Map(lanes.map((entry) => [entry.laneId, entry]));
  const runningTool = visibleEvents
    .filter((event) => event.kind === "tool_call_started")
    .at(-1);
  const runningToolName =
    typeof runningTool?.payload?.toolName === "string"
      ? runningTool.payload.toolName
      : null;
  const isEmpty = timeline.length === 0;
  const liveOwner =
    (lastAgent?.type === "agent" && laneById.get(lastAgent.laneId)) || lane;
  const liveRuntime = runtimePresentation(liveOwner);
  const liveProvider = liveOwner ? laneDisplayName(liveOwner) : "Agente";
  const liveModel = liveOwner ? shortModel(liveOwner.model) : "Modelo ativo";
  const liveActivity = runningToolName
    ? `Executando ${runningToolName}`
    : lastAgent?.type === "agent" && lastAgent.text.length > 0
      ? "Escrevendo resposta"
      : "Pensando";
  const runStartById = new Map<string, string>();
  const lastAgentKeyByRun = new Map<string, string>();
  for (const item of items) {
    if (item.type !== "agent") continue;
    if (!runStartById.has(item.runId)) {
      runStartById.set(item.runId, item.at);
    }
    lastAgentKeyByRun.set(item.runId, item.key);
  }
  const completedRuns = new Map(
    [...runStartById.entries()].map(([runId, startedAt]) => [
      runId,
      telemetryForRun(events, runId, startedAt),
    ]),
  );
  const observedTokens = [...completedRuns.values()].reduce(
    (sum, value) => sum + value.totalTokens,
    0,
  );
  const sessionStart = items.at(0)?.at ? Date.parse(items[0].at) : NaN;
  const sessionEnd = items.at(-1)?.at ? Date.parse(items.at(-1)!.at) : NaN;
  const sessionDuration =
    Number.isFinite(sessionStart) &&
    Number.isFinite(sessionEnd) &&
    sessionEnd >= sessionStart
      ? sessionEnd - sessionStart
      : null;

  return (
    <div aria-label="Conversa da tarefa" className="conversation-scroll">
      {isEmpty ? (
        <div className="conversation-empty">
          <span>
            <MessageSquareText aria-hidden="true" size={18} />
          </span>
          <h2>Conversa pronta</h2>
          <p>
            Escolha uma lane e envie a próxima instrução. Eventos nativos serão
            anexados aqui em tempo real.
          </p>
        </div>
      ) : (
        <div className="conversation-thread" aria-live="polite">
          <div className="conversation-session" aria-label="Resumo da conversa">
            <span>
              <Activity aria-hidden="true" size={12} />
              {completedRuns.size}{" "}
              {completedRuns.size === 1 ? "turno" : "turnos"}
            </span>
            {sessionDuration !== null && sessionDuration > 0 && (
              <span>
                <Clock3 aria-hidden="true" size={12} />
                {formatDuration(sessionDuration)} de atividade
              </span>
            )}
            {observedTokens > 0 && (
              <span title="Entrada nova + cache lido + saída reportados pelos runtimes">
                <Coins aria-hidden="true" size={12} />
                {formatTokens(observedTokens)} tokens observados
              </span>
            )}
          </div>
          {timeline.map((item) => {
            if (item.type === "user") {
              return (
                <article
                  className="message-group message-group--user"
                  key={item.key}
                >
                  <div className="message-bubble message-bubble--user">
                    <MessageMarkdown
                      onOpenExternal={onOpenExternal}
                      onOpenUrl={onOpenUrl}
                    >
                      {item.body}
                    </MessageMarkdown>
                  </div>
                </article>
              );
            }
            if (item.type === "agent") {
              const owner = laneById.get(item.laneId) ?? lane;
              const runtime = runtimePresentation(owner);
              const isLiveTail = isRunning && item.key === lastAgent?.key;
              const provider = owner ? laneDisplayName(owner) : "Agente";
              const model = owner ? shortModel(owner.model) : "Modelo ativo";
              const telemetry = completedRuns.get(item.runId) ?? {
                durationMs: null,
                inputTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                tokensAvailable: true,
              };
              const showsRunTelemetry =
                lastAgentKeyByRun.get(item.runId) === item.key;
              return (
                <article
                  className="message-group message-group--agent"
                  data-live={isLiveTail || undefined}
                  data-tone={runtime.tone}
                  key={item.key}
                >
                  <header className="message-agent-header">
                    <span
                      aria-hidden="true"
                      className={`message-agent-glyph runtime-glyph--${runtime.tone}`}
                    >
                      {runtime.glyph}
                    </span>
                    <span className="message-agent-identity">
                      <strong>{provider}</strong>
                      <span>{model}</span>
                    </span>
                    <span className="message-agent-state">
                      {isLiveTail ? (
                        <Sparkles aria-hidden="true" size={11} />
                      ) : (
                        <Check aria-hidden="true" size={11} />
                      )}
                      {isLiveTail ? "Respondendo" : "Concluído"}
                    </span>
                  </header>
                  {showsRunTelemetry &&
                    (telemetry.durationMs !== null ||
                      telemetry.totalTokens > 0 ||
                      !telemetry.tokensAvailable) && (
                      <div className="message-turn-meta">
                        {telemetry.durationMs !== null && (
                          <span>
                            <Clock3 aria-hidden="true" size={11} />
                            Trabalhou por {formatDuration(telemetry.durationMs)}
                          </span>
                        )}
                        {telemetry.totalTokens > 0 && (
                          <span
                            title={`Entrada ${formatTokens(telemetry.inputTokens)} · cache ${formatTokens(telemetry.cacheReadTokens)} · saída ${formatTokens(telemetry.outputTokens)}`}
                          >
                            <Coins aria-hidden="true" size={11} />
                            {formatTokens(telemetry.totalTokens)} tokens
                          </span>
                        )}
                        {!telemetry.tokensAvailable && (
                          <span title="Este runtime não expõe contagem de tokens">
                            <Coins aria-hidden="true" size={11} />
                            tokens indisponíveis
                          </span>
                        )}
                      </div>
                    )}
                  <div className="message-bubble message-bubble--agent">
                    <span aria-hidden="true" className="message-accent-rail" />
                    <div className="message-bubble__content">
                      <MessageMarkdown
                        onOpenExternal={onOpenExternal}
                        onOpenUrl={onOpenUrl}
                      >
                        {item.text}
                      </MessageMarkdown>
                      {isLiveTail && (
                        <span aria-hidden="true" className="stream-caret" />
                      )}
                    </div>
                  </div>
                </article>
              );
            }
            if (item.type === "agent_activity") {
              return (
                <article className="conversation-event" key={item.key}>
                  <AgentActivityGroup
                    messages={item.messages}
                    onOpenExternal={onOpenExternal}
                    onOpenUrl={onOpenUrl}
                  />
                </article>
              );
            }
            if (item.type === "tools") {
              return (
                <article className="conversation-event" key={item.key}>
                  <ToolGroup
                    events={item.events}
                    telemetry={completedRuns.get(item.runId) ?? null}
                  />
                </article>
              );
            }
            return (
              <article className="conversation-event" key={item.key}>
                <EventCardRegistry event={item.event} />
              </article>
            );
          })}
          {isRunning && (
            <div
              className="chat-live"
              data-tone={liveRuntime.tone}
              role="status"
            >
              <span
                aria-hidden="true"
                className={`message-agent-glyph runtime-glyph--${liveRuntime.tone}`}
              >
                {liveRuntime.glyph}
              </span>
              <span className="chat-live__copy">
                <strong>{liveProvider} está trabalhando</strong>
                <span>
                  {liveModel} · {liveActivity}
                </span>
              </span>
              <span aria-hidden="true" className="chat-live__dots">
                <i />
                <i />
                <i />
              </span>
              <span aria-hidden="true" className="chat-live__rail" />
            </div>
          )}
          <div aria-hidden="true" ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function runtimePresentation(lane: WorkbenchLane | null | undefined) {
  if (!lane) return { glyph: "CL", tone: "claude" } as const;
  return presentRuntime(lane);
}

function shortModel(model: string): string {
  const match = model.match(
    /(?:claude-)?(opus|sonnet|haiku)|((?:gpt|o\d)[\w.-]*)/iu,
  );
  const value = match?.[1] ?? match?.[2] ?? model;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
