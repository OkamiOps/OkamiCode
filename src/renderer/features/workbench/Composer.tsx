import {
  ArrowUp,
  Check,
  Clock3,
  Command,
  FileText,
  FolderTree,
  Globe,
  ListChecks,
  Paperclip,
  Pause,
  Play,
  PlugZap,
  Plus,
  ShieldCheck,
  Square,
  SquareTerminal,
  Target,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { workbenchClient } from "../../lib/ipc/client";
import type { ModelCatalog, ModelFavorites, WorkbenchLane } from "./api";
import { EffortPicker } from "./EffortPicker";
import { ModelPicker } from "./ModelPicker";
import {
  permissionModesForRuntime,
  type PermissionMode,
  type RuntimeKind,
} from "../../../shared/contracts/lane";

interface ComposerProps {
  activeRunId: string | null;
  error: Error | null;
  isCancelling: boolean;
  isOpeningLane: boolean;
  isSending: boolean;
  lane: WorkbenchLane | null;
  catalog: ModelCatalog;
  favorites: ModelFavorites;
  effort: string | null;
  efforts: string[];
  contextNote: string | null;
  contextPercent: number | null;
  contextBreakdown: Array<{
    label: string;
    value: string;
    tone: string;
  }> | null;
  draftKey: string | null;
  taskId: string | null;
  slashCommands: string[];
  suggestions: string[];
  onOpenPanel: (mode: "files" | "terminal" | "browser" | "tasks") => void;
  onOpenUrl: (url: string) => void;
  onNavigate: (path: string) => void;
  onSelectPermissionMode: (mode: PermissionMode) => void;
  onCancel: (runId: string) => Promise<void>;
  onPickFiles: () => Promise<string[]>;
  onSelectEffort: (effort: string) => void;
  onSelectModel: (runtimeKind: RuntimeKind, model: string) => void;
  onSend: (input: string) => Promise<void>;
}

function ComposerAddMenu({
  onAttach,
  onCommand,
  onGoal,
  onNavigate,
  onOpenPanel,
  onOpenUrl,
  suggestions,
}: {
  onAttach: () => void;
  onCommand: () => void;
  onGoal: () => void;
  onNavigate: (path: string) => void;
  onOpenPanel: (mode: "files" | "terminal" | "browser" | "tasks") => void;
  onOpenUrl: (url: string) => void;
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const entry = (label: string, Icon: typeof Paperclip, action: () => void) => (
    <button
      className="conv-menu__item"
      onClick={() => {
        setOpen(false);
        action();
      }}
      type="button"
    >
      <Icon aria-hidden="true" size={13} />
      {label}
    </button>
  );

  return (
    <div className="conv-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-label="Adicionar ao contexto"
        className="chat-attach"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Plus aria-hidden="true" size={15} />
      </button>
      {open && (
        <div className="conv-menu__list conv-menu__list--up" role="menu">
          <span className="conv-menu__label">Contexto</span>
          {entry("Adicionar arquivos ou fotos", Paperclip, onAttach)}
          {entry("Arquivos da pasta", FolderTree, () => onOpenPanel("files"))}
          {entry("Navegador", Globe, () => onOpenPanel("browser"))}
          <span className="conv-menu__separator" />
          <span className="conv-menu__label">Trabalho</span>
          {entry("Terminal", SquareTerminal, () => onOpenPanel("terminal"))}
          {entry("Tarefas em segundo plano", ListChecks, () =>
            onOpenPanel("tasks"),
          )}
          {entry("Definir objetivo", Target, onGoal)}
          {entry("Comandos", Command, onCommand)}
          <span className="conv-menu__separator" />
          <span className="conv-menu__label">Ecossistema</span>
          {entry("Conexões", PlugZap, () => onNavigate("/connections"))}
          {entry("Agentes e plugins", Users, () => onNavigate("/agents"))}
          {suggestions.length > 0 && (
            <>
              <span className="conv-menu__separator" />
              <span className="conv-menu__label">Sugeridos</span>
              {suggestions.slice(0, 6).map((url) => (
                <button
                  className="conv-menu__item"
                  key={url}
                  onClick={() => {
                    setOpen(false);
                    onOpenUrl(url);
                  }}
                  type="button"
                >
                  <Globe aria-hidden="true" size={13} />
                  <span className="conv-menu__url">{url}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const PERMISSION_MODES: Array<{
  id: PermissionMode;
  label: string;
  hint?: string;
}> = [
  { id: "manual", label: "Manual" },
  { id: "acceptEdits", label: "Aceitar edições" },
  { id: "plan", label: "Planejar" },
  { id: "auto", label: "Automático" },
  {
    id: "bypassPermissions",
    label: "Ignorar permissões",
    hint: "sem checagens",
  },
];

function PermissionModeMenu({
  mode,
  runtime,
  onSelect,
}: {
  mode: string;
  runtime: RuntimeKind;
  onSelect: (mode: PermissionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const current =
    PERMISSION_MODES.find((entry) => entry.id === mode) ?? PERMISSION_MODES[0];
  const allowed = permissionModesForRuntime(runtime);

  return (
    <div className="conv-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        className="chat-permission"
        onClick={() => setOpen((value) => !value)}
        title="Modo de permissão da lane"
        type="button"
      >
        <ShieldCheck aria-hidden="true" size={12} />
        {current.label}
      </button>
      {open && (
        <div className="conv-menu__list conv-menu__list--up" role="menu">
          <span className="conv-menu__label">Modo</span>
          {PERMISSION_MODES.filter((entry) => allowed.includes(entry.id)).map(
            (entry, index) => (
              <button
                className="conv-menu__item"
                data-checked={entry.id === current.id || undefined}
                data-danger={entry.id === "bypassPermissions" || undefined}
                key={entry.id}
                onClick={() => {
                  setOpen(false);
                  onSelect(entry.id);
                }}
                type="button"
              >
                {entry.label}
                {entry.hint && <small>{entry.hint}</small>}
                <kbd>{index + 1}</kbd>
              </button>
            ),
          )}
          <p className="conv-menu__note">
            A sessão desta lane é reiniciada no próximo turno para aplicar o
            modo.
          </p>
        </div>
      )}
    </div>
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
  favorites,
  effort,
  efforts,
  contextNote,
  contextPercent,
  contextBreakdown,
  draftKey,
  taskId,
  slashCommands,
  suggestions,
  onOpenPanel,
  onOpenUrl,
  onNavigate,
  onSelectPermissionMode,
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
  const [contextOpen, setContextOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const [goal, setGoal] = useState<ComposerGoal | null>(() =>
    readGoal(draftKey),
  );
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

  // "@" opens a file picker over the conversation folder, the way Claude and
  // Cursor let you point at a file without leaving the keyboard.
  const mentionTerm = /(?:^|\s)@([^\s@]*)$/u.exec(input)?.[1] ?? null;
  const mentions = useQuery({
    queryKey: ["fs-search", taskId, mentionTerm],
    queryFn: () =>
      workbenchClient.fsSearch({ taskId: taskId!, query: mentionTerm ?? "" }),
    enabled: mentionTerm !== null && taskId !== null,
  });
  const mentionMatches =
    mentionTerm !== null ? (mentions.data?.files ?? []) : [];
  const mentionHighlight = Math.min(
    mentionIndex,
    Math.max(mentionMatches.length - 1, 0),
  );

  function applyMention(file: string) {
    const next = input.replace(/(^|\s)@[^\s@]*$/u, `$1@${file} `);
    updateInput(next);
    setMentionIndex(0);
    textareaRef.current?.focus();
  }

  // The menu tracks the first token only: once a space lands, the command is
  // chosen and the rest of the message is free text.
  const slashMatches = useMemo(() => {
    if (!input.startsWith("/") || /\s/u.test(input)) return [];
    const term = input.slice(1).toLowerCase();
    return [...new Set(["goal", ...slashCommands])]
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
    const goalText = /^\/goal\s+(.+)$/isu.exec(outgoing)?.[1]?.trim();
    if (goalText) {
      const nextGoal: ComposerGoal = {
        text: goalText,
        status: "active",
        startedAt: new Date().toISOString(),
      };
      setGoal(nextGoal);
      persistGoal(draftKey, nextGoal);
    }
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
    if (mentionMatches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((mentionHighlight + 1) % mentionMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (mentionHighlight - 1 + mentionMatches.length) %
            mentionMatches.length,
        );
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        applyMention(mentionMatches[mentionHighlight]);
        return;
      }
    }
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
      {mentionMatches.length > 0 && (
        <ul aria-label="Arquivos da pasta" className="chat-slash-menu">
          {mentionMatches.slice(0, 8).map((file, index) => (
            <li key={file}>
              <button
                data-active={index === mentionHighlight || undefined}
                onClick={() => applyMention(file)}
                type="button"
              >
                {file}
              </button>
            </li>
          ))}
        </ul>
      )}
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
      {goal && (
        <div className="chat-goal" data-status={goal.status}>
          <span className="chat-goal__icon" aria-hidden="true">
            <Target size={13} />
          </span>
          <span className="chat-goal__body">
            <small>
              Objetivo {goal.status === "paused" ? "pausado" : "em andamento"}
            </small>
            <strong>{goal.text}</strong>
          </span>
          <span className="chat-goal__elapsed">
            {formatGoalAge(goal.startedAt)}
          </span>
          <button
            aria-label={
              goal.status === "paused" ? "Retomar objetivo" : "Pausar objetivo"
            }
            onClick={() => {
              const next: ComposerGoal = {
                ...goal,
                status: goal.status === "paused" ? "active" : "paused",
              };
              setGoal(next);
              persistGoal(draftKey, next);
            }}
            type="button"
          >
            {goal.status === "paused" ? (
              <Play size={12} />
            ) : (
              <Pause size={12} />
            )}
          </button>
          <button
            aria-label="Concluir objetivo"
            onClick={() => {
              setGoal(null);
              persistGoal(draftKey, null);
            }}
            type="button"
          >
            <Check size={13} />
          </button>
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
        {lane && (
          <PermissionModeMenu
            mode={lane.permissionMode ?? "manual"}
            onSelect={onSelectPermissionMode}
            runtime={lane.runtimeKind}
          />
        )}
        <ComposerAddMenu
          onAttach={() => void attachFiles()}
          onCommand={() => updateInput("/")}
          onGoal={() => updateInput("/goal ")}
          onNavigate={onNavigate}
          onOpenPanel={onOpenPanel}
          onOpenUrl={onOpenUrl}
          suggestions={suggestions}
        />
        {/* Switching models never sends a prompt, so a running turn must not
            lock the picker. */}
        <ModelPicker
          catalog={catalog}
          favorites={favorites}
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
          <button
            className="chat-context-note"
            data-tone={
              contextPercent === null
                ? "ok"
                : contextPercent >= 85
                  ? "high"
                  : contextPercent >= 60
                    ? "warn"
                    : "ok"
            }
            onClick={() => setContextOpen((value) => !value)}
            title={`Janela de contexto · ${contextNote}`}
            type="button"
          >
            {contextPercent !== null && (
              <span aria-hidden="true" className="chat-context-bar">
                <i style={{ width: `${contextPercent}%` }} />
              </span>
            )}
            {contextNote}
            {contextPercent !== null && <strong>{contextPercent}%</strong>}
          </button>
        )}
        {contextOpen && contextBreakdown && (
          <div className="context-pop">
            <header>
              <strong>Janela de contexto</strong>
              <button
                aria-label="Fechar"
                onClick={() => setContextOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={12} />
              </button>
            </header>
            <p className="context-pop__total">
              {contextNote}
              {contextPercent !== null && (
                <span> · {contextPercent}% cheia</span>
              )}
            </p>
            <ul>
              {contextBreakdown.map((entry) => (
                <li key={entry.label}>
                  <span
                    aria-hidden="true"
                    className={`context-pop__swatch context-pop__swatch--${entry.tone}`}
                  />
                  {entry.label}
                  <strong>{entry.value}</strong>
                </li>
              ))}
            </ul>
            <p className="context-pop__note">
              Do último relatório de uso do harness: entrada, cache lido e
              saída. O harness não decompõe além disso.
            </p>
          </div>
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

interface ComposerGoal {
  text: string;
  status: "active" | "paused";
  startedAt: string;
}

function goalStorageKey(draftKey: string | null): string | null {
  return draftKey ? `okami.goal.${draftKey}` : null;
}

function readGoal(draftKey: string | null): ComposerGoal | null {
  const key = goalStorageKey(draftKey);
  if (!key) return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(key) ?? "null",
    ) as ComposerGoal | null;
    return value?.text && ["active", "paused"].includes(value.status)
      ? value
      : null;
  } catch {
    return null;
  }
}

function persistGoal(draftKey: string | null, goal: ComposerGoal | null) {
  const key = goalStorageKey(draftKey);
  if (!key) return;
  try {
    if (goal) localStorage.setItem(key, JSON.stringify(goal));
    else localStorage.removeItem(key);
  } catch {
    // The visible goal remains usable when persistence is unavailable.
  }
}

function formatGoalAge(startedAt: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(startedAt));
  if (!Number.isFinite(elapsed)) return "agora";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
