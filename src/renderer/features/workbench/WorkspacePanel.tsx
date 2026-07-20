import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  Globe,
  GripVertical,
  Maximize2,
  Minimize2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { workbenchClient } from "../../lib/ipc/client";
import { MessageMarkdown } from "./MessageMarkdown";
import { TerminalPane } from "./TerminalPane";

export type WorkspacePanelMode = "files" | "browser" | "terminal" | "tasks";

export const PANEL_TITLES: Record<WorkspacePanelMode, string> = {
  files: "Arquivos",
  terminal: "Terminal",
  browser: "Navegador",
  tasks: "Tarefas em segundo plano",
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  toml: "toml",
};

function DirNode({
  taskId,
  dir,
  name,
  depth,
  filter,
  onOpenFile,
}: {
  taskId: string;
  dir: string;
  name: string | null;
  depth: number;
  filter: string;
  onOpenFile: (file: string) => void;
}) {
  // A filter expands the tree so matches are reachable without clicking.
  const [open, setOpen] = useState(name === null);
  const expanded = open || filter.length > 0;
  const listing = useQuery({
    queryKey: ["workspace-fs", taskId, dir],
    queryFn: () => workbenchClient.fsList({ taskId, dir }),
    enabled: expanded,
  });

  return (
    <div className="fs-node">
      {name !== null && (
        <button
          className="fs-row fs-row--dir"
          onClick={() => setOpen((value) => !value)}
          style={{ paddingLeft: 8 + depth * 14 }}
          type="button"
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" size={12} />
          ) : (
            <ChevronRight aria-hidden="true" size={12} />
          )}
          <Folder aria-hidden="true" size={12} />
          {name}
        </button>
      )}
      {expanded &&
        (listing.data?.entries ?? [])
          .filter(
            (entry) =>
              filter === "" ||
              entry.kind === "dir" ||
              entry.name.toLowerCase().includes(filter),
          )
          .map((entry) => {
            const childPath = dir ? `${dir}/${entry.name}` : entry.name;
            if (entry.kind === "dir") {
              return (
                <DirNode
                  depth={depth + 1}
                  dir={childPath}
                  filter={filter}
                  key={childPath}
                  name={entry.name}
                  onOpenFile={onOpenFile}
                  taskId={taskId}
                />
              );
            }
            return (
              <button
                className="fs-row fs-row--file"
                key={childPath}
                onClick={() => onOpenFile(childPath)}
                style={{ paddingLeft: 8 + (depth + 1) * 14 }}
                type="button"
              >
                <FileCode2 aria-hidden="true" size={12} />
                {entry.name}
              </button>
            );
          })}
      {expanded && name === null && listing.data?.entries.length === 0 && (
        <p className="fs-empty">Pasta vazia.</p>
      )}
    </div>
  );
}

function FileView({ taskId, file }: { taskId: string; file: string }) {
  const content = useQuery({
    queryKey: ["workspace-file", taskId, file],
    queryFn: () => workbenchClient.fsRead({ taskId, file }),
  });
  if (content.isLoading) return <p className="fs-empty">Abrindo…</p>;
  if (content.isError || !content.data) {
    return <p className="fs-empty">Não foi possível abrir este arquivo.</p>;
  }
  if (content.data.binary) {
    return <p className="fs-empty">Arquivo binário — sem visualização.</p>;
  }
  const extension = file.split(".").at(-1)?.toLowerCase() ?? "";
  const language = LANGUAGE_BY_EXTENSION[extension] ?? "";
  const fence = "````";
  return (
    <div className="fs-file">
      <MessageMarkdown>
        {`${fence}${language}\n${content.data.content}\n${fence}`}
      </MessageMarkdown>
      {content.data.truncated && (
        <p className="fs-empty">
          Arquivo grande — mostrando os primeiros 256 KB.
        </p>
      )}
    </div>
  );
}

function duration(startedAt: string, finishedAt: string | null): string {
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// What a run did, expanded under its row: the tools it called and the reply
// it produced.
function RunDetail({ runId }: { runId: string }) {
  const events = useQuery({
    queryKey: ["run-events", runId],
    queryFn: () => workbenchClient.runEvents({ runId }),
  });
  if (events.isLoading) return <p className="fs-empty">Carregando…</p>;
  if (events.isError) {
    return <p className="fs-empty">Não foi possível ler este turno.</p>;
  }
  const rows = events.data ?? [];
  const tools = rows.filter(
    (event) =>
      event.kind === "tool_call_started" ||
      event.kind === "tool_call_completed",
  );
  const byTool = new Map<string, { name: string; detail: string | null }>();
  for (const event of tools) {
    const id = String(event.payload.toolUseId ?? event.id);
    // Only the "started" event carries the tool name; the completion must
    // not overwrite it with a placeholder.
    const named =
      typeof event.payload.toolName === "string"
        ? event.payload.toolName
        : null;
    const input = event.payload.input as Record<string, unknown> | undefined;
    const detail =
      typeof input?.command === "string"
        ? input.command
        : typeof input?.file_path === "string"
          ? input.file_path
          : null;
    const existing = byTool.get(id);
    byTool.set(id, {
      name: named ?? existing?.name ?? "ferramenta",
      detail: detail ?? existing?.detail ?? null,
    });
  }
  const reply = rows
    .filter((event) => event.kind === "message_completed")
    .map((event) => String(event.payload.text ?? ""))
    .join("\n")
    .trim();

  return (
    <div className="ws-task__detail">
      {byTool.size === 0 && !reply && (
        <p className="fs-empty">Este turno não registrou ferramentas.</p>
      )}
      {[...byTool.values()].map((tool, index) => (
        <div className="ws-task__tool" key={`${tool.name}-${index}`}>
          <strong>{tool.name}</strong>
          {tool.detail && <code>{tool.detail}</code>}
        </div>
      ))}
      {reply && (
        <p className="ws-task__reply">
          {reply.length > 400 ? `${reply.slice(0, 400)}…` : reply}
        </p>
      )}
    </div>
  );
}

// Every turn this app has run, with how it ended — the panel Claude keeps
// as "Tarefas em segundo plano".
function TasksPane({ taskId }: { taskId: string }) {
  const [openRun, setOpenRun] = useState<string | null>(null);
  const runs = useQuery({
    queryKey: ["workspace-runs", taskId],
    queryFn: () => workbenchClient.runList({ taskId }),
    refetchInterval: 5_000,
  });
  const rows = runs.data ?? [];
  const done = rows.filter((row) => row.status === "completed").length;
  const running = rows.filter((row) => row.status === "running").length;

  return (
    <div className="ws-tasks">
      <div className="ws-tasks__summary">
        {running > 0 && (
          <span className="ws-tasks__running">{running} em curso</span>
        )}
        <span>Concluído {done}</span>
      </div>
      {runs.isError && (
        <p className="fs-empty">
          Não foi possível ler os turnos: {String(runs.error)}
        </p>
      )}
      {!runs.isError && rows.length === 0 && !runs.isLoading && (
        <p className="fs-empty">Nenhum turno registrado nesta conversa.</p>
      )}
      {rows.map((row) => (
        <div key={row.runId}>
          <button
            aria-expanded={openRun === row.runId}
            className="ws-task"
            data-status={row.status}
            onClick={() =>
              setOpenRun((current) =>
                current === row.runId ? null : row.runId,
              )
            }
            type="button"
          >
            <span className="ws-task__dot" aria-hidden="true" />
            <span className="ws-task__meta">
              <strong>{row.model}</strong>
              <small>
                {row.status} · {duration(row.startedAt, row.finishedAt)}
              </small>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="ws-task__chevron"
              size={12}
            />
          </button>
          {openRun === row.runId && <RunDetail runId={row.runId} />}
        </div>
      ))}
    </div>
  );
}

function BrowserPane({ initialUrl }: { initialUrl: string | null }) {
  const [address, setAddress] = useState(initialUrl ?? "http://localhost:5173");
  const [target, setTarget] = useState<string | null>(initialUrl);
  const [reloadNonce, setReloadNonce] = useState(0);

  function navigate() {
    const trimmed = address.trim();
    if (!trimmed) return;
    const url = /^[a-z]+:\/\//u.test(trimmed) ? trimmed : `http://${trimmed}`;
    setAddress(url);
    setTarget(url);
    setReloadNonce((value) => value + 1);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      navigate();
    }
  }

  return (
    <div className="ws-browser">
      <div className="ws-browser__bar">
        <input
          aria-label="Endereço"
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={handleKey}
          placeholder="http://localhost:3000"
          value={address}
        />
        <button
          aria-label="Ir / recarregar"
          onClick={navigate}
          title="Ir / recarregar"
          type="button"
        >
          <RotateCw aria-hidden="true" size={13} />
        </button>
      </div>
      {target ? (
        <webview
          className="ws-browser__view"
          key={`${target}:${reloadNonce}`}
          // Isolated, throwaway session: guests never share the app session.
          partition="preview"
          src={target}
        />
      ) : (
        <div className="ws-browser__empty">
          <Globe aria-hidden="true" size={20} />
          <p>
            Pré-visualize seu dev server ou qualquer URL sem sair da conversa.
          </p>
        </div>
      )}
    </div>
  );
}

export function WorkspacePanel({
  taskId,
  workspacePath,
  mode,
  openFile,
  onOpenFile,
  onClose,
  initialUrl = null,
  isMaximized = false,
  onToggleMaximize,
  onDragStart,
  onMoveByKeyboard,
  isDropTarget = false,
}: {
  taskId: string;
  workspacePath?: string | null;
  mode: WorkspacePanelMode;
  openFile: string | null;
  onOpenFile: (file: string | null) => void;
  onClose: () => void;
  initialUrl?: string | null;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onDragStart?: () => void;
  onMoveByKeyboard?: (offset: number) => void;
  isDropTarget?: boolean;
}) {
  const [filter, setFilter] = useState("");
  return (
    <section
      aria-label={PANEL_TITLES[mode]}
      className="workspace-pane"
      data-drop-target={isDropTarget || undefined}
      data-panel={mode}
    >
      <header
        aria-label={`Mover ${PANEL_TITLES[mode]}`}
        className="workspace-panel__header"
        role={onDragStart ? "toolbar" : undefined}
        tabIndex={onDragStart ? 0 : undefined}
        onKeyDown={(event) => {
          // Keyboard parity: the arrows move the panel between slots.
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onMoveByKeyboard?.(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
        onMouseDown={(event) => {
          // Pointer-driven rather than HTML5 drag-and-drop: the same
          // mechanism as the pane divider, and one that actually fires.
          if (event.button !== 0 || !onDragStart) return;
          // Without this the browser starts a text selection and the drag
          // never gets the pointer.
          event.preventDefault();
          onDragStart();
        }}
      >
        <GripVertical
          aria-hidden="true"
          className="workspace-panel__grip"
          size={12}
        />
        <strong>{PANEL_TITLES[mode]}</strong>
        {mode === "files" && openFile && (
          <button
            className="workspace-panel__crumb"
            onClick={() => onOpenFile(null)}
            title="Voltar para a árvore"
            type="button"
          >
            {openFile}
          </button>
        )}
        <span className="workspace-panel__spacer" />
        {onToggleMaximize && (
          <button
            aria-label={isMaximized ? "Restaurar painel" : "Expandir painel"}
            className="workspace-panel__close"
            onClick={onToggleMaximize}
            title={isMaximized ? "Restaurar" : "Ocupar todo o painel"}
            type="button"
          >
            {isMaximized ? (
              <Minimize2 aria-hidden="true" size={12} />
            ) : (
              <Maximize2 aria-hidden="true" size={12} />
            )}
          </button>
        )}
        <button
          aria-label="Fechar painel"
          className="workspace-panel__close"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={13} />
        </button>
      </header>
      <div className="workspace-panel__body">
        {mode === "tasks" ? (
          <TasksPane taskId={taskId} />
        ) : mode === "terminal" ? (
          <TerminalPane taskId={taskId} />
        ) : mode === "browser" ? (
          <BrowserPane initialUrl={initialUrl} key={initialUrl ?? "blank"} />
        ) : openFile ? (
          <FileView file={openFile} taskId={taskId} />
        ) : (
          <>
            <label className="fs-filter">
              <Search aria-hidden="true" size={12} />
              <input
                aria-label="Filtrar arquivos"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filtrar arquivos…"
                value={filter}
              />
            </label>
            {workspacePath && (
              <span className="fs-root" title={workspacePath}>
                {workspacePath}
              </span>
            )}
            <div className="fs-tree">
              <DirNode
                depth={0}
                dir=""
                filter={filter.trim().toLowerCase()}
                name={null}
                onOpenFile={onOpenFile}
                taskId={taskId}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
