import { Card, Chip } from "@heroui/react";
import {
  CheckCircle2,
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
    return {
      Icon: CheckCircle2,
      label: "concluído",
      tone: "text-[var(--ok-green)]",
    };
  }
  if (kind.endsWith("updated")) {
    return {
      Icon: CircleDotDashed,
      label: "em andamento",
      tone: "text-[var(--ok-cyan)]",
    };
  }
  return {
    Icon: CircleDashed,
    label: "iniciado",
    tone: "text-[var(--ok-yellow)]",
  };
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

  return (
    <Card className="rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] border-l-2 border-l-[var(--ok-orange)] bg-[var(--ok-surface-1)]">
      <Card.Header className="flex items-start gap-2 px-3 py-2.5">
        <Wrench
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[var(--ok-orange)]"
          size={15}
        />
        <div className="min-w-0 flex-1">
          <Card.Title className="truncate text-xs font-semibold">
            {tool}
          </Card.Title>
          {command && (
            <code className="mt-1 block overflow-x-auto whitespace-pre text-[11px] text-[var(--ok-cyan)]">
              {command}
            </code>
          )}
          {command && (
            <TerminalDrawer
              command={command}
              output={output}
              workspacePath={workspacePath}
            />
          )}
        </div>
        <Chip
          className={`border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[10px] ${tone}`}
          size="sm"
          variant="secondary"
        >
          <Icon aria-hidden="true" className="mr-1 inline" size={10} />
          {label}
        </Chip>
      </Card.Header>
    </Card>
  );
}
