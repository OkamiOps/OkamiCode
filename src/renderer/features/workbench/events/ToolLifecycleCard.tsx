import { Accordion, Card } from "@heroui/react";
import { diffLines } from "diff";
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

const MAX_DIFF_LINES = 120;

// Edits render as a real diff; Write shows the new content as additions.
function DiffView({ payload }: { payload: Record<string, unknown> }) {
  const input =
    payload.input && typeof payload.input === "object"
      ? (payload.input as Record<string, unknown>)
      : {};
  const oldText = typeof input.old_string === "string" ? input.old_string : "";
  const newText =
    typeof input.new_string === "string"
      ? input.new_string
      : typeof input.content === "string"
        ? input.content
        : "";
  if (!oldText && !newText) return null;
  const rows: Array<{ key: string; tone: string; text: string }> = [];
  for (const [index, part] of diffLines(oldText, newText).entries()) {
    if (rows.length >= MAX_DIFF_LINES) break;
    const tone = part.added ? "add" : part.removed ? "del" : "ctx";
    const prefix = part.added ? "+" : part.removed ? "-" : " ";
    const lines = part.value.replace(/\n$/u, "").split("\n");
    for (const [lineIndex, line] of lines.entries()) {
      if (rows.length >= MAX_DIFF_LINES) break;
      rows.push({
        key: `${index}-${lineIndex}`,
        tone,
        text: `${prefix} ${line}`,
      });
    }
  }
  const capped = rows.length >= MAX_DIFF_LINES;
  return (
    <pre className="tool-diff">
      {rows.map((row) => (
        <span
          className={`tool-diff__line tool-diff__line--${row.tone}`}
          key={row.key}
        >
          {row.text}
        </span>
      ))}
      {capped && (
        <span className="tool-diff__line tool-diff__line--ctx">…</span>
      )}
    </pre>
  );
}

const DIFF_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export function ToolLifecycleCard({ event }: ToolLifecycleCardProps) {
  const rawTool =
    valueAt(event.payload, ["toolName", "nativeItemType", "nativeMethod"]) ??
    event.kind.replaceAll("_", " ");
  const description = valueAt(event.payload, ["description"]);
  // Subagents deserve their own identity instead of a generic "Task".
  const tool =
    rawTool === "Task"
      ? `Subagente${description ? ` · ${description}` : ""}`
      : rawTool;
  const filePath = valueAt(event.payload, ["file_path"]);
  const showDiff = DIFF_TOOLS.has(rawTool);
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
                {command ? ` · ${command}` : filePath ? ` · ${filePath}` : ""}
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
              {showDiff && <DiffView payload={event.payload} />}
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
