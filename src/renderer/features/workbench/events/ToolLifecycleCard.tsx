import { Accordion, Card } from "@heroui/react";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleDotDashed,
  Wrench,
} from "lucide-react";
import { TerminalDrawer } from "../advanced/TerminalDrawer";
import type { EventCardEvent } from "./EventCardRegistry";

interface ToolLifecycleCardProps {
  event: EventCardEvent;
}

function valueAt(
  value: unknown,
  keys: readonly string[],
  seen = new WeakSet<object>(),
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key];
    }
  }
  for (const nested of Object.values(record)) {
    const match = valueAt(nested, keys, seen);
    if (match) return match;
  }
  return undefined;
}

function eventStatus(kind: string) {
  if (kind.endsWith("completed") || kind === "approval_resolved") {
    return { Icon: CheckCircle2, label: "concluído", tone: "ok" } as const;
  }
  if (kind.endsWith("updated")) {
    return {
      Icon: CircleDotDashed,
      label: "em andamento",
      tone: "run",
    } as const;
  }
  return { Icon: CircleDashed, label: "iniciado", tone: "wait" } as const;
}

export function ToolLifecycleCard({ event }: ToolLifecycleCardProps) {
  const tool =
    valueAt(event.payload, ["toolName", "nativeItemType", "nativeMethod"]) ??
    event.kind.replaceAll("_", " ");
  const command = valueAt(event.payload, ["command"]);
  const output =
    valueAt(event.payload, ["aggregatedOutput", "output", "delta"]) ?? "";
  const workspacePath = valueAt(event.payload, ["cwd", "workspacePath"]);
  const { Icon, label, tone } = eventStatus(event.kind);
  const itemId = event.id ?? `${event.kind}-tool`;

  return (
    <Card className="tool-card">
      <Accordion defaultExpandedKeys={output ? [itemId] : []} hideSeparator>
        <Accordion.Item id={itemId}>
          <Accordion.Heading>
            <Accordion.Trigger className="tool-card__header">
              <Wrench aria-hidden="true" size={13} />
              <span className="tool-card__name">
                {tool}
                {command ? ` · ${command}` : ""}
              </span>
              <span className={`tool-card__state tool-card__state--${tone}`}>
                <Icon aria-hidden="true" size={10} />
                {label}
              </span>
              <ChevronDown aria-hidden="true" size={12} />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body>
              <pre className="tool-card__output">
                {output || command || "O runtime não forneceu saída textual."}
              </pre>
              {(command || output) && (
                <div className="tool-card__advanced">
                  <TerminalDrawer
                    command={command}
                    output={output}
                    workspacePath={workspacePath}
                  />
                </div>
              )}
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  );
}
