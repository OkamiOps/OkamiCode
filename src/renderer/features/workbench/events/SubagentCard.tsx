import { Accordion, Card, Chip } from "@heroui/react";
import { Bot, CheckCircle2, ChevronDown, Network } from "lucide-react";
import type { EventCardEvent } from "./EventCardRegistry";

interface SubagentCardProps {
  event: EventCardEvent;
}

function text(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const direct = payload[key];
  if (typeof direct === "string") return direct;
  const item = payload.item;
  if (item && typeof item === "object") {
    const nested = (item as Record<string, unknown>)[key];
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

export function SubagentCard({ event }: SubagentCardProps) {
  const completed = event.kind === "subagent_completed";
  const name =
    text(event.payload, "agentName") ??
    text(event.payload, "name") ??
    text(event.payload, "nativeItemType") ??
    "Subagente";
  const summary =
    text(event.payload, "summary") ??
    text(event.payload, "prompt") ??
    text(event.payload, "status");

  return (
    <Card className="tool-card">
      <Accordion hideSeparator>
        <Accordion.Item id={event.id ?? `${event.kind}-subagent`}>
          <Accordion.Heading>
            <Accordion.Trigger className="tool-card__header">
              <Network
                aria-hidden="true"
                className="text-[var(--ok-cyan)]"
                size={15}
              />
              <span className="tool-card__name">{name}</span>
              <Chip
                className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[10px] text-[var(--ok-text-muted)]"
                size="sm"
                variant="secondary"
              >
                {completed ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="mr-1 inline"
                    size={10}
                  />
                ) : (
                  <Bot aria-hidden="true" className="mr-1 inline" size={10} />
                )}
                {completed ? "concluído" : "executando"}
              </Chip>
              <ChevronDown aria-hidden="true" size={13} />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className="border-t border-[var(--ok-border)] px-3 py-2 text-[11px] leading-5 text-[var(--ok-text-muted)]">
              {summary ?? "O runtime não forneceu detalhes adicionais."}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}
