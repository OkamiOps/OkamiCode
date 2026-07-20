import { Surface } from "@heroui/react";
import { ChevronRight, MessageSquareText, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { canonicalEventSchema } from "../../../shared/contracts/event";
import type { WorkbenchLane } from "./api";
import {
  EventCardRegistry,
  type EventCardEvent,
} from "./events/EventCardRegistry";
import { laneDisplayName } from "./LaneSelector";
import { useWorkbenchStore } from "./store";

const TEXT_EVENT_KINDS = new Set(["message_delta", "message_completed"]);

// Lifecycle chatter that Claude/Codex desktop apps do not surface as cards.
const HIDDEN_EVENT_KINDS = new Set([
  "session_started",
  "session_resumed",
  "usage_reported",
  "rate_limit_updated",
  "run_completed",
]);

function isVisibleEvent(event: EventCardEvent): boolean {
  if (!event.kind) return false;
  if (TEXT_EVENT_KINDS.has(event.kind)) return false;
  if (HIDDEN_EVENT_KINDS.has(event.kind)) return false;
  // Hook plumbing and streamed tool-input chunks are audit detail, not
  // conversation; the started/completed pair carries the whole story.
  if (event.kind === "tool_call_updated") return false;
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

function toolGroupLabel(events: EventCardEvent[]): string {
  const names = [
    ...new Set(
      events.map((event) =>
        typeof event.payload?.toolName === "string"
          ? event.payload.toolName
          : "ferramenta",
      ),
    ),
  ];
  const running = events.some((event) => event.kind === "tool_call_started");
  const verb = running ? "Usando" : "Usou";
  if (events.length === 1) return `${verb} ${names[0]}`;
  const detail = names.slice(0, 3).join(", ");
  return `${verb} ${events.length} ferramentas · ${detail}`;
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

  const laneById = new Map(lanes.map((entry) => [entry.laneId, entry]));
  const runningTool = visibleEvents
    .filter((event) => event.kind === "tool_call_started")
    .at(-1);
  const runningToolName =
    typeof runningTool?.payload?.toolName === "string"
      ? runningTool.payload.toolName
      : null;
  const isEmpty = timeline.length === 0;

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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {item.body}
                    </ReactMarkdown>
                  </Surface>
                </article>
              );
            }
            if (item.type === "agent") {
              const owner = laneById.get(item.laneId) ?? lane;
              const runtime = runtimePresentation(owner);
              return (
                <article
                  className="message-group message-group--agent"
                  key={item.key}
                >
                  <header className="message-agent-header">
                    <span
                      aria-hidden="true"
                      className={`message-agent-glyph runtime-glyph--${runtime.tone}`}
                    >
                      {runtime.glyph}
                    </span>
                    <strong>
                      {owner
                        ? `${laneDisplayName(owner)} · ${shortModel(owner.model)}`
                        : "Agente"}
                    </strong>
                    <span>
                      · harness{" "}
                      {owner?.harness === "native" ? "nativo" : "Claude Code"}
                    </span>
                  </header>
                  <Surface className="message-bubble" variant="secondary">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {item.text}
                    </ReactMarkdown>
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
        </div>
      )}
    </div>
  );
}

function runtimePresentation(lane: WorkbenchLane | null | undefined) {
  if (!lane) return { glyph: "CL", tone: "claude" } as const;
  const account = `${lane.providerAccountLabel} ${lane.model}`.toLowerCase();
  if (account.includes("grok")) return { glyph: "GK", tone: "grok" } as const;
  if (/chatgpt|\bgpt|\bo[134]/u.test(account)) {
    return { glyph: "GP", tone: "gpt" } as const;
  }
  return { glyph: "CL", tone: "claude" } as const;
}

function shortModel(model: string): string {
  const match = model.match(
    /(?:claude-)?(opus|sonnet|haiku)|((?:gpt|o\d)[\w.-]*)/iu,
  );
  const value = match?.[1] ?? match?.[2] ?? model;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
