import { ArrowUp, Paperclip, Square } from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ModelCatalog, WorkbenchLane } from "./api";
import { EffortPicker } from "./EffortPicker";
import { ModelPicker } from "./ModelPicker";

interface ComposerProps {
  activeRunId: string | null;
  error: Error | null;
  isCancelling: boolean;
  isOpeningLane: boolean;
  isSending: boolean;
  lane: WorkbenchLane | null;
  catalog: ModelCatalog;
  effort: string | null;
  efforts: string[];
  contextNote: string | null;
  slashCommands: string[];
  onCancel: (runId: string) => Promise<void>;
  onPickFiles: () => Promise<string[]>;
  onSelectEffort: (effort: string) => void;
  onSelectModel: (runtimeKind: "claude" | "codex", model: string) => void;
  onSend: (input: string) => Promise<void>;
}

export function Composer({
  activeRunId,
  error,
  isCancelling,
  isOpeningLane,
  isSending,
  lane,
  catalog,
  effort,
  efforts,
  contextNote,
  slashCommands,
  onCancel,
  onPickFiles,
  onSelectEffort,
  onSelectModel,
  onSend,
}: ComposerProps) {
  const [input, setInput] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  // The menu tracks the first token only: once a space lands, the command is
  // chosen and the rest of the message is free text.
  const slashMatches = useMemo(() => {
    if (!input.startsWith("/") || /\s/u.test(input)) return [];
    const term = input.slice(1).toLowerCase();
    return slashCommands
      .filter((name) => name.toLowerCase().startsWith(term))
      .slice(0, 8);
  }, [input, slashCommands]);
  const highlighted = Math.min(
    slashIndex,
    Math.max(slashMatches.length - 1, 0),
  );

  async function submit() {
    const trimmed = input.trim();
    if (!lane || !trimmed || isSending || activeRunId) return;
    await onSend(trimmed);
    setInput("");
  }

  function applySlashCommand(name: string) {
    setInput(`/${name} `);
    setSlashIndex(0);
  }

  async function attachFiles() {
    const paths = await onPickFiles();
    if (paths.length === 0) return;
    const quoted = paths
      .map((path) => (path.includes(" ") ? `"${path}"` : path))
      .join(" ");
    setInput((current) =>
      current.length === 0 || current.endsWith(" ")
        ? `${current}${quoted} `
        : `${current} ${quoted} `,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (slashMatches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((highlighted + 1) % slashMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex(
          (highlighted - 1 + slashMatches.length) % slashMatches.length,
        );
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        applySlashCommand(slashMatches[highlighted]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setInput(" ".concat(input).trimStart());
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      {slashMatches.length > 0 && (
        <ul aria-label="Comandos disponíveis" className="chat-slash-menu">
          {slashMatches.map((name, index) => (
            <li key={name}>
              <button
                data-active={index === highlighted || undefined}
                onClick={() => applySlashCommand(name)}
                type="button"
              >
                /{name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        aria-label="Mensagem"
        disabled={isSending}
        onChange={(event) => {
          setInput(event.target.value);
          setSlashIndex(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Como posso ajudar? Digite / para comandos"
        rows={1}
        value={input}
      />
      <div className="chat-composer__row">
        <button
          aria-label="Anexar arquivos"
          className="chat-attach"
          disabled={!lane || isSending}
          onClick={() => void attachFiles()}
          title="Anexar arquivos (o caminho entra na mensagem)"
          type="button"
        >
          <Paperclip aria-hidden="true" size={14} />
        </button>
        {/* Switching models never sends a prompt, so a running turn must not
            lock the picker. */}
        <ModelPicker
          catalog={catalog}
          disabled={isSending}
          isOpening={isOpeningLane}
          onSelectModel={onSelectModel}
          selectedLane={lane}
        />
        {lane && (
          <EffortPicker
            disabled={isSending}
            efforts={efforts}
            onSelect={onSelectEffort}
            selected={effort}
          />
        )}
        <span className="chat-composer__spacer" />
        {contextNote && (
          <span
            className="chat-context-note"
            title="Estimativa local a partir dos eventos de uso da sessão"
          >
            {contextNote}
          </span>
        )}
        {activeRunId ? (
          <button
            className="chat-stop"
            disabled={isCancelling}
            onClick={() => void onCancel(activeRunId)}
            type="button"
          >
            <Square aria-hidden="true" size={11} />
            Interromper
          </button>
        ) : (
          <button
            aria-label="Enviar"
            className="chat-send"
            disabled={!lane || !input.trim() || isSending}
            type="submit"
          >
            <ArrowUp aria-hidden="true" size={16} strokeWidth={2.4} />
          </button>
        )}
      </div>
      {error && (
        <p className="chat-composer__error" role="alert">
          {error.message}
        </p>
      )}
    </form>
  );
}
