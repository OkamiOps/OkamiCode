import { Surface } from "@heroui/react";
import { MessageSquareText } from "lucide-react";
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
  lane,
}: {
  initialEvents?: EventCardEvent[];
  lane: WorkbenchLane | null;
}) {
  const sentMessages = useWorkbenchStore((state) => state.sentMessages);
  const streams = useWorkbenchStore((state) => state.streams);
  const [events, setEvents] = useState<EventCardEvent[]>(() =>
    initialEvents.filter(isVisibleEvent),
  );
  const visibleEvents = mergeToolLifecycle(events);
  const streamedMessages = Object.entries(streams);
  const isEmpty =
    sentMessages.length === 0 &&
    streamedMessages.length === 0 &&
    visibleEvents.length === 0;
  const runtime = runtimePresentation(lane);

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
          {sentMessages.map((message) => (
            <article
              className="message-group message-group--user"
              key={message.id}
            >
              <Surface className="message-bubble" variant="secondary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.body}
                </ReactMarkdown>
              </Surface>
              <div className="message-stamp">agora · você</div>
            </article>
          ))}
          {streamedMessages.map(([key, body]) => (
            <article className="message-group message-group--agent" key={key}>
              <header className="message-agent-header">
                <span
                  aria-hidden="true"
                  className={`message-agent-glyph runtime-glyph--${runtime.tone}`}
                >
                  {runtime.glyph}
                </span>
                <strong>
                  {lane
                    ? `${laneDisplayName(lane)} · ${shortModel(lane.model)}`
                    : "Agente"}
                </strong>
                <span>
                  · harness{" "}
                  {lane?.harness === "native" ? "nativo" : "Claude Code"}
                </span>
              </header>
              <Surface className="message-bubble" variant="secondary">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {body}
                </ReactMarkdown>
              </Surface>
              <div className="message-stamp">agora · streaming</div>
            </article>
          ))}
          {visibleEvents.map((event, index) => (
            <article
              className="conversation-event"
              key={event.id ?? `${event.kind}-${index}`}
            >
              <EventCardRegistry event={event} />
              <div className="message-stamp">
                {formatTimestamp(event.occurredAt)} · evento da lane
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function runtimePresentation(lane: WorkbenchLane | null) {
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

function formatTimestamp(value?: string): string {
  if (!value) return "agora";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "agora";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
