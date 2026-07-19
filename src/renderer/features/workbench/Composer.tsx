import { ArrowUp, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { WorkbenchLane } from "./api";
import { ModelPicker } from "./ModelPicker";

interface ComposerProps {
  activeRunId: string | null;
  error: Error | null;
  isCancelling: boolean;
  isOpeningLane: boolean;
  isSending: boolean;
  lane: WorkbenchLane | null;
  lanes: WorkbenchLane[];
  onCancel: (runId: string) => Promise<void>;
  onSelectLane: (laneId: string) => void;
  onSend: (input: string) => Promise<void>;
}

export function Composer({
  activeRunId,
  error,
  isCancelling,
  isOpeningLane,
  isSending,
  lane,
  lanes,
  onCancel,
  onSelectLane,
  onSend,
}: ComposerProps) {
  const [input, setInput] = useState("");

  async function submit() {
    const trimmed = input.trim();
    if (!lane || !trimmed || isSending || activeRunId) return;
    await onSend(trimmed);
    setInput("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      <textarea
        aria-label="Mensagem"
        disabled={isSending}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Como posso ajudar?"
        rows={1}
        value={input}
      />
      <div className="chat-composer__row">
        <ModelPicker
          disabled={Boolean(activeRunId) || isSending}
          isOpening={isOpeningLane}
          lanes={lanes}
          onSelect={onSelectLane}
          selectedLaneId={lane?.laneId ?? null}
        />
        <span className="chat-composer__spacer" />
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
