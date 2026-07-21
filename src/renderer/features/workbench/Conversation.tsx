import { Surface } from "@heroui/react";
import { ChevronRight, MessageSquareText, Wrench } from "lucide-react";
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
  laneId: string;
  text: string;
}

interface TimelineToolsItem {
  type: "tools";
  at: string;
  key: string;
  events: EventCardEvent[];
}

interface TimelineCardItem {
  type: "card";
  at: string;
  key: string;
  event: EventCardEvent;
}

type TimelineItem =
  TimelineUserItem | TimelineAgentItem | TimelineToolsItem | TimelineCardItem;

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

function ToolGroup({ events }: { events: EventCardEvent[] }) {
  const [open, setOpen] = useState(false);
  const running = events.some((event) => event.kind === "tool_call_started");
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
        {toolGroupLabel(events)}
        <ChevronRight
          aria-hidden="true"
          className="chat-toolgroup__chevron"
          size={12}
        />
      </button>
      {open && (
        <div className="chat-toolgroup__items">
          {events.map((event, index) => (
            <EventCardRegistry
              event={event}
              key={event.id ?? `${event.kind}-${index}`}
            />
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
}: {
  initialEvents?: EventCardEvent[];
  isRunning?: boolean;
  lane: WorkbenchLane | null;
  lanes?: WorkbenchLane[];
}) {
  const sentMessages = useWorkbenchStore((state) => state.sentMessages);
  const streams = useWorkbenchStore((state) => state.streams);
  const [events, setEvents] = useState<EventCardEvent[]>(() =>
    initialEvents.filter(isVisibleEvent),
  );

  useEffect(() => {
    if (!window.okami?.onEvent) return;
    return window.okami.onEvent((raw) => {
      const event = eventForCard(raw);
      if (!isVisibleEvent(event)) return;
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
  for (const [key, entry] of Object.entries(streams)) {
    items.push({
      type: "agent",
      at: entry.at,
      key,
      laneId: entry.laneId,
      text: entry.text,
    });
  }
  const visibleEvents = mergeToolLifecycle(events);
  for (const event of visibleEvents) {
    const key = event.id ?? `${event.kind}-${event.occurredAt}`;
    items.push({
      type: "card",
      at: event.occurredAt ?? "",
      key,
      event,
    });
  }
  items.sort((left, right) => left.at.localeCompare(right.at));
  const timeline: TimelineItem[] = [];
  for (const item of items) {
    const last = timeline.at(-1);
    if (item.type === "card" && TOOL_EVENT_KINDS.has(item.event.kind)) {
      if (last?.type === "tools") {
        last.events.push(item.event);
        continue;
      }
      timeline.push({
        type: "tools",
        at: item.at,
        key: item.key,
        events: [item.event],
      });
      continue;
    }
    timeline.push(item);
  }

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
  // Tracks the last agent label while rendering the thread in order.
  let lastSpeaker: string | null = null;

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
          {timeline.map((item) => {
            if (item.type === "user") {
              return (
                <article
                  className="message-group message-group--user"
                  key={item.key}
                >
                  <Surface className="message-bubble" variant="secondary">
                    <MessageMarkdown>{item.body}</MessageMarkdown>
                  </Surface>
                </article>
              );
            }
            if (item.type === "agent") {
              const owner = laneById.get(item.laneId) ?? lane;
              const runtime = runtimePresentation(owner);
              const isLiveTail = isRunning && item.key === lastAgent?.key;
              // The speaker line only appears when it changes: repeating it
              // on every reply is the noise Claude and Codex avoid.
              const speaker = owner
                ? `${laneDisplayName(owner)} · ${shortModel(owner.model)}`
                : "Agente";
              const showSpeaker = speaker !== lastSpeaker;
              lastSpeaker = speaker;
              return (
                <article
                  className="message-group message-group--agent"
                  data-tone={runtime.tone}
                  key={item.key}
                >
                  {showSpeaker && (
                    <header className="message-agent-header">
                      <span
                        aria-hidden="true"
                        className={`message-agent-glyph runtime-glyph--${runtime.tone}`}
                      >
                        {runtime.glyph}
                      </span>
                      <strong>{speaker}</strong>
                    </header>
                  )}
                  <Surface className="message-bubble" variant="secondary">
                    <MessageMarkdown>{item.text}</MessageMarkdown>
                    {isLiveTail && (
                      <span aria-hidden="true" className="stream-caret" />
                    )}
                  </Surface>
                </article>
              );
            }
            if (item.type === "tools") {
              return (
                <article className="conversation-event" key={item.key}>
                  <ToolGroup events={item.events} />
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
            <div className="chat-live" role="status">
              <span aria-hidden="true" className="chat-live__orb" />
              <span className="chat-live__text">
                {runningToolName
                  ? `Executando ${runningToolName}…`
                  : "Pensando…"}
              </span>
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
