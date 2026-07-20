import { ArrowUp, Clock3, FileText, Paperclip, Square, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
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
  contextPercent: number | null;
  draftKey: string | null;
  slashCommands: string[];
  onCancel: (runId: string) => Promise<void>;
  onPickFiles: () => Promise<string[]>;
  onSelectEffort: (effort: string) => void;
  onSelectModel: (runtimeKind: "claude" | "codex", model: string) => void;
  onSend: (input: string) => Promise<void>;
}

// Miniature gauge: the arc fills with the session context, warming from
// accent to red as the window runs out.
function ContextRing({ percent }: { percent: number }) {
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  const tone =
    percent >= 85 ? "#fb6b75" : percent >= 60 ? "#ffc26b" : "#ff7a1a";
  return (
    <svg
      aria-hidden="true"
      className="chat-context-ring"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <circle
        cx="8"
        cy="8"
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeWidth="2"
      />
      <circle
        cx="8"
        cy="8"
        fill="none"
        r={radius}
        stroke={tone}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
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
  contextPercent,
  draftKey,
  slashCommands,
  onCancel,
  onPickFiles,
  onSelectEffort,
  onSelectModel,
  onSend,
}: ComposerProps) {
  // The parent keys this component by conversation, so the draft loads once
  // per conversation via the lazy initializer instead of an effect.
  const [input, setInput] = useState(() => {
    if (!draftKey) return "";
    try {
      return localStorage.getItem(`okami.draft.${draftKey}`) ?? "";
    } catch {
      return "";
    }
  });
  const [slashIndex, setSlashIndex] = useState(0);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSentRef = useRef<string>("");
  const dispatchingRef = useRef(false);

  function resizeTextarea() {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }

  function updateInput(value: string) {
    setInput(value);
    setSlashIndex(0);
    if (draftKey) {
      try {
        if (value) localStorage.setItem(`okami.draft.${draftKey}`, value);
        else localStorage.removeItem(`okami.draft.${draftKey}`);
      } catch {
        // Draft persistence is best effort.
      }
    }
    requestAnimationFrame(resizeTextarea);
  }

  // Messages typed during a run wait in line and fire as soon as the lane
  // frees up — the Claude/Codex "queue while working" behavior.
  useEffect(() => {
    if (activeRunId || isSending || queued.length === 0) return;
    if (dispatchingRef.current) return;
    const timer = window.setTimeout(() => {
      dispatchingRef.current = true;
      const [next, ...rest] = queued;
      setQueued(rest);
      void onSend(next).finally(() => {
        dispatchingRef.current = false;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeRunId, isSending, queued, onSend]);

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

  function composeOutgoing(): string {
    const trimmed = input.trim();
    const quoted = attachments
      .map((path) => (path.includes(" ") ? `"${path}"` : path))
      .join(" ");
    return [trimmed, quoted].filter(Boolean).join("\n\n");
  }

  async function submit() {
    const outgoing = composeOutgoing();
    if (!lane || !outgoing || isSending) return;
    lastSentRef.current = outgoing;
    updateInput("");
    setAttachments([]);
    if (activeRunId) {
      setQueued((current) => [...current, outgoing]);
      return;
    }
    await onSend(outgoing);
    // A disabled/blurred field would swallow whatever the user types next.
    textareaRef.current?.focus();
  }

  function applySlashCommand(name: string) {
    updateInput(`/${name} `);
    textareaRef.current?.focus();
  }

  async function attachFiles() {
    const paths = await onPickFiles();
    if (paths.length === 0) return;
    setAttachments((current) => [
      ...current,
      ...paths.filter((path) => !current.includes(path)),
    ]);
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
        updateInput(" ".concat(input).trimStart());
        return;
      }
    }
    if (event.key === "ArrowUp" && input === "" && lastSentRef.current) {
      event.preventDefault();
      updateInput(lastSentRef.current);
      return;
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
      {attachments.length > 0 && (
        <div aria-label="Anexos" className="chat-attachments">
          {attachments.map((path) => (
            <span className="chat-attachment" key={path} title={path}>
              <FileText aria-hidden="true" size={11} />
              {path.split("/").filter(Boolean).at(-1)}
              <button
                aria-label={`Remover ${path}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((item) => item !== path),
                  )
                }
                type="button"
              >
                <X aria-hidden="true" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {queued.length > 0 && (
        <div aria-label="Mensagens na fila" className="chat-queue">
          {queued.map((message, index) => (
            <span className="chat-queue__item" key={`${index}-${message}`}>
              <Clock3 aria-hidden="true" size={11} />
              {message.length > 60 ? `${message.slice(0, 60)}…` : message}
              <button
                aria-label="Remover da fila"
                onClick={() =>
                  setQueued((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
                type="button"
              >
                <X aria-hidden="true" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        aria-label="Mensagem"
        onChange={(event) => updateInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Como posso ajudar? Digite / para comandos"
        ref={textareaRef}
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
          onSelectModel={(runtimeKind, model) => {
            onSelectModel(runtimeKind, model);
            // Picking a model must hand the keyboard back to the message.
            textareaRef.current?.focus();
          }}
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
            title={`Contexto da sessão · ${contextNote} (estimativa local)`}
          >
            {contextPercent !== null && (
              <ContextRing percent={contextPercent} />
            )}
            {contextPercent !== null ? `${contextPercent}%` : contextNote}
          </span>
        )}
        {activeRunId ? (
          <span className="chat-run-actions">
            <button
              className="chat-stop"
              disabled={isCancelling}
              onClick={() => void onCancel(activeRunId)}
              type="button"
            >
              <Square aria-hidden="true" size={11} />
              Interromper
            </button>
            <button
              aria-label="Enviar para a fila"
              className="chat-send"
              disabled={!input.trim() && attachments.length === 0}
              title="Entra na fila e envia quando o turno atual terminar"
              type="submit"
            >
              <ArrowUp aria-hidden="true" size={16} strokeWidth={2.4} />
            </button>
          </span>
        ) : (
          <button
            aria-label="Enviar"
            className="chat-send"
            disabled={
              !lane || (!input.trim() && attachments.length === 0) || isSending
            }
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
