import {
  Files,
  Globe,
  ListChecks,
  MoreVertical,
  Pencil,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspacePanelMode } from "./WorkspacePanel";

// The per-conversation menu Claude Desktop keeps behind "⋮": panels on the
// left of the divider, conversation actions on the right.
export function ConversationMenu({
  activePanels,
  onDelete,
  onRename,
  onTogglePanel,
}: {
  activePanels: WorkspacePanelMode[];
  onDelete: () => void;
  onRename: () => void;
  onTogglePanel: (mode: WorkspacePanelMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = (
    label: string,
    Icon: typeof Files,
    action: () => void,
    options: { checked?: boolean; danger?: boolean; shortcut?: string } = {},
  ) => (
    <button
      className="conv-menu__item"
      data-checked={options.checked || undefined}
      data-danger={options.danger || undefined}
      onClick={() => {
        setOpen(false);
        action();
      }}
      type="button"
    >
      <Icon aria-hidden="true" size={13} />
      {label}
      {options.shortcut && <kbd>{options.shortcut}</kbd>}
    </button>
  );

  return (
    <div className="conv-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="Ações da conversa"
        className="chat-topbar__tool"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <MoreVertical aria-hidden="true" size={14} />
      </button>
      {open && (
        <div className="conv-menu__list" role="menu">
          {item("Arquivos", Files, () => onTogglePanel("files"), {
            checked: activePanels.includes("files"),
          })}
          {item("Terminal", SquareTerminal, () => onTogglePanel("terminal"), {
            checked: activePanels.includes("terminal"),
          })}
          {item("Navegador", Globe, () => onTogglePanel("browser"), {
            checked: activePanels.includes("browser"),
          })}
          {item(
            "Tarefas em segundo plano",
            ListChecks,
            () => onTogglePanel("tasks"),
            {
              checked: activePanels.includes("tasks"),
            },
          )}
          <span className="conv-menu__separator" />
          {item("Mudar o nome", Pencil, onRename, { shortcut: "R" })}
          {item("Apagar", Trash2, onDelete, { danger: true, shortcut: "D" })}
        </div>
      )}
    </div>
  );
}
