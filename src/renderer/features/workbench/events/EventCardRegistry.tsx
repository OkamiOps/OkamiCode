import { Accordion, Card } from "@heroui/react";
import { Bug, ChevronDown } from "lucide-react";
import type { ComponentType } from "react";
import type { CanonicalEventKind } from "../../../../shared/contracts/event";
import { workbenchClient } from "../../../lib/ipc/client";
import { ApprovalCard, type ApprovalResolver } from "./ApprovalCard";
import { BrowserCard } from "./BrowserCard";
import { DiffCard } from "./DiffCard";
import { HtmlPreviewCard } from "./HtmlPreviewCard";
import { SubagentCard } from "./SubagentCard";
import { ToolLifecycleCard } from "./ToolLifecycleCard";

export interface EventCardEvent {
  id?: string;
  kind: string;
  occurredAt?: string;
  laneId?: string;
  runId?: string;
  payload: Record<string, unknown>;
}

interface EventCardRegistryProps {
  event: EventCardEvent;
  onApprovalResolve?: ApprovalResolver;
}

interface EventRendererProps {
  event: EventCardEvent;
  onResolve: ApprovalResolver;
}

type EventRenderer = ComponentType<EventRendererProps>;

function findString(
  value: unknown,
  keys: ReadonlySet<string>,
  seen = new WeakSet<object>(),
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (keys.has(key.toLowerCase()) && typeof candidate === "string") {
      return candidate;
    }
  }
  for (const nested of Object.values(record)) {
    const result = findString(nested, keys, seen);
    if (result) return result;
  }
  return undefined;
}

function ToolSurfaceCard({ event }: EventRendererProps) {
  const html = findString(event.payload, new Set(["html", "srcdoc"]));
  if (html) return <HtmlPreviewCard html={html} />;

  const url = findString(event.payload, new Set(["url"]));
  const screenshot = findString(
    event.payload,
    new Set(["screenshot", "screenshoturl"]),
  );
  if (url) {
    const title = findString(event.payload, new Set(["title"]));
    return <BrowserCard screenshot={screenshot} title={title} url={url} />;
  }

  const diff = findString(event.payload, new Set(["diff", "patch"]));
  if (diff) return <DiffCard diff={diff} />;

  return <ToolLifecycleCard event={event} />;
}

function ApprovalEventCard({ event, onResolve }: EventRendererProps) {
  return <ApprovalCard event={event} onResolve={onResolve} />;
}

function SubagentEventCard({ event }: EventRendererProps) {
  return <SubagentCard event={event} />;
}

function LifecycleEventCard({ event }: EventRendererProps) {
  return <ToolLifecycleCard event={event} />;
}

const EVENT_RENDERERS = Object.freeze({
  session_started: LifecycleEventCard,
  session_resumed: LifecycleEventCard,
  message_delta: LifecycleEventCard,
  message_completed: LifecycleEventCard,
  tool_call_started: ToolSurfaceCard,
  tool_call_updated: ToolSurfaceCard,
  tool_call_completed: ToolSurfaceCard,
  approval_requested: ApprovalEventCard,
  approval_resolved: ApprovalEventCard,
  subagent_started: SubagentEventCard,
  subagent_completed: SubagentEventCard,
  usage_reported: LifecycleEventCard,
  rate_limit_updated: LifecycleEventCard,
  run_failed: LifecycleEventCard,
  run_cancelled: LifecycleEventCard,
  run_completed: LifecycleEventCard,
}) satisfies Record<CanonicalEventKind, EventRenderer>;

const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|cookie|credential|password|secret|session|token)/iu;
const SENSITIVE_TEXT =
  /(?:bearer\s+[a-z0-9._~+/=-]+|\b(?:sk|xox[a-z]?|gh[pousr])[-_][a-z0-9._-]{8,})/giu;

function redactDiagnostic(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") {
    return value.replace(SENSITIVE_TEXT, "[redacted]");
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[redacted]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnostic(item, "", seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([nestedKey, item]) => [
        nestedKey,
        redactDiagnostic(item, nestedKey, seen),
      ],
    ),
  );
}

function UnknownEventCard({ event }: { event: EventCardEvent }) {
  const diagnosticJson = JSON.stringify(redactDiagnostic(event), null, 2);

  return (
    <Card className="rounded-[var(--ok-radius-md)] border border-[color-mix(in_srgb,var(--ok-red)_35%,var(--ok-border))] bg-[var(--ok-surface-1)]">
      <Accordion hideSeparator>
        <Accordion.Item id={event.id ?? `unknown-${event.kind}`}>
          <Accordion.Heading>
            <Accordion.Trigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[var(--ok-red)]">
              <Bug aria-hidden="true" size={15} />
              <span className="min-w-0 flex-1">
                <strong className="block text-xs">
                  Evento não reconhecido
                </strong>
                <span className="block truncate text-[10px] text-[var(--ok-text-muted)]">
                  {event.kind}
                </span>
              </span>
              <ChevronDown aria-hidden="true" size={13} />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="border-t border-[var(--ok-border)] p-3">
              <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-[var(--ok-text-muted)]">
                {diagnosticJson}
              </pre>
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}

const resolveThroughMain: ApprovalResolver = async (request) => {
  await workbenchClient.approvalResolve(request);
};

export function EventCardRegistry({
  event,
  onApprovalResolve = resolveThroughMain,
}: EventCardRegistryProps) {
  const Renderer = EVENT_RENDERERS[event.kind as CanonicalEventKind] as
    EventRenderer | undefined;
  if (!Renderer) return <UnknownEventCard event={event} />;
  return <Renderer event={event} onResolve={onApprovalResolve} />;
}
