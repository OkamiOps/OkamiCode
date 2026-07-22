import { useQuery } from "@tanstack/react-query";
import { html as renderDiff } from "diff2html";
import { ColorSchemeType } from "diff2html/lib/types";
import "diff2html/bundles/css/diff2html.min.css";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  FileCode2,
  FileDiff,
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

export type WorkspacePanelMode =
  "changes" | "files" | "browser" | "terminal" | "tasks";

export const PANEL_TITLES: Record<WorkspacePanelMode, string> = {
  changes: "Alterações",
  files: "Arquivos",
  terminal: "Terminal",
  browser: "Navegador",
  tasks: "Tarefas em segundo plano",
};

const CHANGE_LABELS = {
  modified: "Modificado",
  added: "Adicionado",
  deleted: "Excluído",
  renamed: "Renomeado",
  copied: "Copiado",
  untracked: "Novo",
  conflicted: "Conflito",
} as const;

function WorktreePane({ taskId }: { taskId: string }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const changes = useQuery({
    queryKey: ["workspace-changes", taskId],
    queryFn: () => workbenchClient.workspaceChanges({ taskId }),
    refetchInterval: 1_500,
  });
  const currentFile =
    changes.data?.files.find((entry) => entry.path === selectedFile)?.path ??
    changes.data?.files[0]?.path ??
    null;
  const diff = useQuery({
    queryKey: ["workspace-diff", taskId, currentFile],
    queryFn: () =>
      workbenchClient.workspaceDiff({ taskId, file: currentFile ?? "" }),
    enabled: currentFile !== null,
    refetchInterval: 1_500,
  });
  const diffHtml = diff.data?.patch
    ? renderDiff(diff.data.patch, {
        colorScheme: ColorSchemeType.DARK,
        drawFileList: false,
        matching: "lines",
        outputFormat: "line-by-line",
      })
    : "";

  if (changes.isLoading) {
    return <p className="fs-empty">Lendo o worktree…</p>;
  }
  if (changes.isError) {
    return <p className="fs-empty">Não foi possível ler as alterações Git.</p>;
  }
  if (!changes.data?.isRepo) {
    return (
      <div className="worktree-empty">
        <FileDiff aria-hidden="true" size={22} />
        <strong>Esta pasta não é um repositório Git</strong>
        <span>
          O explorador de arquivos continua disponível na aba Arquivos.
        </span>
      </div>
    );
  }

  if (changes.data.files.length === 0) {
    return (
      <div className="worktree-clean-state">
        <span className="worktree-clean-state__icon">
          <Check aria-hidden="true" size={18} />
        </span>
        <div>
          <strong>Nenhuma mudança pendente</strong>
          <span>
            O painel acompanha o Git automaticamente e abre o diff assim que um
            arquivo for criado, alterado ou removido.
          </span>
        </div>
        <span className="worktree-clean-state__branch">
          {changes.data.branch}
        </span>
        <button
          aria-label="Atualizar alterações"
          onClick={() => void changes.refetch()}
          title="Atualizar agora"
          type="button"
        >
          <RotateCw aria-hidden="true" size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="worktree-pane">
      <aside className="worktree-pane__changes">
        <div className="worktree-summary">
          <span className="worktree-summary__branch">
            {changes.data.branch}
          </span>
          <strong>{changes.data.files.length}</strong>
          <span>
            {changes.data.files.length === 1 ? "alteração" : "alterações"}
          </span>
          <button
            aria-label="Atualizar alterações"
            onClick={() => void changes.refetch()}
            title="Atualizar agora"
            type="button"
          >
            <RotateCw aria-hidden="true" size={13} />
          </button>
        </div>
        <div className="worktree-file-list">
          {changes.data.files.map((file) => (
            <button
              className="worktree-file"
              data-active={currentFile === file.path || undefined}
              data-status={file.status}
              key={`${file.path}:${file.previousPath ?? ""}`}
              onClick={() => setSelectedFile(file.path)}
              type="button"
            >
              <span className="worktree-file__status" aria-hidden="true">
                {file.status === "untracked"
                  ? "U"
                  : file.status[0]?.toUpperCase()}
              </span>
              <span className="worktree-file__identity">
                <strong>{file.path.split("/").at(-1)}</strong>
                <small>
                  {file.path.includes("/")
                    ? file.path.slice(0, file.path.lastIndexOf("/"))
                    : "raiz"}
                </small>
              </span>
              <span className="worktree-file__label">
                {CHANGE_LABELS[file.status]}
              </span>
              {file.staged && <i title="Preparado para commit">S</i>}
            </button>
          ))}
        </div>
      </aside>
      <section className="worktree-pane__diff" aria-label="Diff do arquivo">
        {currentFile ? (
          <>
            <header className="worktree-diff__header">
              <FileDiff aria-hidden="true" size={14} />
              <strong>{currentFile}</strong>
              <span>Atualização automática</span>
            </header>
            {diff.isLoading ? (
              <p className="fs-empty">Montando o diff…</p>
            ) : diffHtml ? (
              <div
                className="worktree-diff__content"
                // diff2html escapes source content and provides accessible line structure.
                dangerouslySetInnerHTML={{ __html: diffHtml }}
              />
            ) : (
              <div className="worktree-empty">
                <FileDiff aria-hidden="true" size={20} />
                <strong>Sem diff textual</strong>
                <span>
                  O arquivo pode ser binário ou a alteração já foi consolidada.
                </span>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}

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
  const extension = file.split(".").at(-1)?.toLowerCase() ?? "";
  const isMarkdown = extension === "md" || extension === "mdx";
  const [view, setView] = useState<"preview" | "source">(
    isMarkdown ? "preview" : "source",
  );
  const [copied, setCopied] = useState(false);
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
  const language = LANGUAGE_BY_EXTENSION[extension] ?? "";
  const fence = "````";

  function copyFile() {
    void navigator.clipboard.writeText(content.data!.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    });
  }

  return (
    <div
      className="fs-file"
      data-format={isMarkdown && view === "preview" ? "markdown" : "source"}
    >
      <div className="fs-file__toolbar">
        <span className="fs-file__kind">
          {isMarkdown && view === "preview" ? "Leitura" : language || "Texto"}
        </span>
        {isMarkdown && (
          <span
            className="fs-file__view-switch"
            role="group"
            aria-label="Modo de visualização"
          >
            <button
              aria-pressed={view === "preview"}
              onClick={() => setView("preview")}
              type="button"
            >
              <Eye aria-hidden="true" size={12} />
              Formatado
            </button>
            <button
              aria-pressed={view === "source"}
              onClick={() => setView("source")}
              type="button"
            >
              <Code2 aria-hidden="true" size={12} />
              Fonte
            </button>
          </span>
        )}
        <button className="fs-file__copy" onClick={copyFile} type="button">
          {copied ? (
            <Check aria-hidden="true" size={12} />
          ) : (
            <Copy aria-hidden="true" size={12} />
          )}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <div className="fs-file__content">
        {isMarkdown && view === "preview" ? (
          <MessageMarkdown>{content.data.content}</MessageMarkdown>
        ) : (
          <MessageMarkdown>
            {`${fence}${language}\n${content.data.content}\n${fence}`}
          </MessageMarkdown>
        )}
      </div>
      {content.data.truncated && (
        <p className="fs-empty">
          Arquivo grande — mostrando os primeiros 256 KB.
        </p>
      )}
    </div>
  );
}

// Reads as what happened, not as the tool that did it: the action is plain
// language and the emphasis sits on the file or command it touched.
function describeToolCall(
  name: string,
  detail: string | null,
): { verb: string; target: string | null; tone: string } {
  const file = detail?.split("/").filter(Boolean).at(-1) ?? detail;
  // Older runs stored no tool input, so each phrase stands on its own when
  // there is nothing to point at — "Criou" alone tells the reader nothing.
  const phrase = (
    withTarget: string,
    alone: string,
    target: string | null,
    tone: string,
  ) =>
    target
      ? { verb: withTarget, target, tone }
      : { verb: alone, target: null, tone };

  switch (name) {
    case "Read":
      return phrase("Leu", "Leu um arquivo", file, "read");
    case "Write":
      return phrase("Criou", "Criou um arquivo", file, "create");
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return phrase("Editou", "Editou um arquivo", file, "edit");
    case "Bash":
      return phrase("Rodou", "Rodou um comando", detail, "exec");
    case "Glob":
      return phrase("Procurou arquivos", "Procurou arquivos", detail, "read");
    case "Grep":
      return phrase("Buscou no código", "Buscou no código", detail, "read");
    case "WebFetch":
      return phrase("Abriu", "Abriu uma página", detail, "web");
    case "WebSearch":
      return phrase("Pesquisou", "Fez uma busca na web", detail, "web");
    case "Task":
      return phrase("Subagente", "Chamou um subagente", detail, "agent");
    case "TodoWrite":
      return { verb: "Atualizou o plano", target: null, tone: "plan" };
    default:
      return phrase(`Usou ${name}`, `Usou ${name}`, detail, "read");
  }
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
          : typeof input?.pattern === "string"
            ? input.pattern
            : typeof input?.description === "string"
              ? input.description
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
      {[...byTool.values()].map((tool, index) => {
        const action = describeToolCall(tool.name, tool.detail);
        return (
          <div
            className="ws-task__tool"
            data-tone={action.tone}
            key={`${tool.name}-${index}`}
          >
            <span aria-hidden="true" className="ws-task__pip" />
            <span className="ws-task__verb">{action.verb}</span>
            {action.target && (
              <code className="ws-task__target">{action.target}</code>
            )}
          </div>
        );
      })}
      {reply && (
        <div className="ws-task__reply">
          <MessageMarkdown>{reply}</MessageMarkdown>
        </div>
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
  const [target, setTarget] = useState<string | null>(
    initialUrl ?? "http://localhost:5173",
  );
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
        {mode === "changes" ? (
          <WorktreePane taskId={taskId} />
        ) : mode === "tasks" ? (
          <TasksPane taskId={taskId} />
        ) : mode === "terminal" ? (
          <TerminalPane taskId={taskId} />
        ) : mode === "browser" ? (
          <BrowserPane initialUrl={initialUrl} key={initialUrl ?? "blank"} />
        ) : openFile ? (
          <FileView file={openFile} key={openFile} taskId={taskId} />
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
