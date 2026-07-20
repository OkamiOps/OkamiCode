import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  Globe,
  RotateCw,
  X,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { workbenchClient } from "../../lib/ipc/client";
import { MessageMarkdown } from "./MessageMarkdown";
import { TerminalPane } from "./TerminalPane";

export type WorkspacePanelMode = "files" | "browser" | "terminal";

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
  onOpenFile,
}: {
  taskId: string;
  dir: string;
  name: string | null;
  depth: number;
  onOpenFile: (file: string) => void;
}) {
  const [open, setOpen] = useState(name === null);
  const listing = useQuery({
    queryKey: ["workspace-fs", taskId, dir],
    queryFn: () => workbenchClient.fsList({ taskId, dir }),
    enabled: open,
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
          {open ? (
            <ChevronDown aria-hidden="true" size={12} />
          ) : (
            <ChevronRight aria-hidden="true" size={12} />
          )}
          <Folder aria-hidden="true" size={12} />
          {name}
        </button>
      )}
      {open &&
        (listing.data?.entries ?? []).map((entry) => {
          const childPath = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.kind === "dir") {
            return (
              <DirNode
                depth={depth + 1}
                dir={childPath}
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
      {open && name === null && listing.data?.entries.length === 0 && (
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

function BrowserPane() {
  const [address, setAddress] = useState("http://localhost:5173");
  const [target, setTarget] = useState<string | null>(null);
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
  mode,
  onClose,
}: {
  taskId: string;
  mode: WorkspacePanelMode;
  onClose: () => void;
}) {
  const [openFile, setOpenFile] = useState<string | null>(null);

  return (
    <aside aria-label="Painel de trabalho" className="workspace-panel">
      <header className="workspace-panel__header">
        <strong>
          {mode === "files"
            ? "Arquivos"
            : mode === "browser"
              ? "Navegador"
              : "Terminal"}
        </strong>
        {mode === "files" && openFile && (
          <button
            className="workspace-panel__crumb"
            onClick={() => setOpenFile(null)}
            title="Voltar para a árvore"
            type="button"
          >
            {openFile}
          </button>
        )}
        <span className="workspace-panel__spacer" />
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
        {mode === "terminal" ? (
          <TerminalPane taskId={taskId} />
        ) : mode === "browser" ? (
          <BrowserPane />
        ) : openFile ? (
          <FileView file={openFile} taskId={taskId} />
        ) : (
          <div className="fs-tree">
            <DirNode
              depth={0}
              dir=""
              name={null}
              onOpenFile={setOpenFile}
              taskId={taskId}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
