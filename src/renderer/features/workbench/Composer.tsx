import { Button, Chip, Label, TextArea, TextField } from "@heroui/react";
import {
  Bot,
  FolderCode,
  Route,
  Send,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { WorkbenchLane } from "./api";

interface ComposerProps {
  activeRunId: string | null;
  error: Error | null;
  isCancelling: boolean;
  isSending: boolean;
  lane: WorkbenchLane | null;
  onCancel: (runId: string) => Promise<void>;
  onSend: (input: string) => Promise<void>;
}

function harnessLabel(lane: WorkbenchLane): string {
  return lane.harness === "claude" ? "Claude Code" : "Runtime nativo";
}

function metadataValue(value: string | null): string {
  return value ?? "Não informado";
}

export function Composer({
  activeRunId,
  error,
  isCancelling,
  isSending,
  lane,
  onCancel,
  onSend,
}: ComposerProps) {
  const [input, setInput] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!lane || !trimmed || isSending) return;
    await onSend(trimmed);
    setInput("");
  }

  return (
    <form
      className="border-t border-[var(--ok-border)] bg-[var(--ok-surface-1)] p-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      {lane ? (
        <div
          aria-label="Rota efetiva da lane"
          className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ok-text-muted)]"
        >
          <Chip
            className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok-text)]"
            size="sm"
            variant="secondary"
          >
            <Bot aria-hidden="true" className="mr-1 inline" size={11} />
            {harnessLabel(lane)}
          </Chip>
          <Chip
            className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok-text)]"
            size="sm"
            variant="secondary"
          >
            {lane.providerAccountLabel}
          </Chip>
          <Chip
            className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok-text)]"
            size="sm"
            variant="secondary"
          >
            {lane.model}
          </Chip>
          <Chip
            className="border border-[var(--ok-border)] bg-[var(--ok-bg)] text-[var(--ok-cyan)]"
            size="sm"
            variant="secondary"
          >
            <Route aria-hidden="true" className="mr-1 inline" size={11} />
            {lane.routeKind}
          </Chip>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck aria-hidden="true" size={11} />
            {metadataValue(lane.permissionMode)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <FolderCode aria-hidden="true" size={11} />
            {metadataValue(lane.workspacePath)}
          </span>
          <span>Assinatura: {lane.displayQuotaAccount}</span>
          {lane.temperature === "stale" && lane.pendingDeltaEvents > 0 && (
            <span className="text-[var(--ok-yellow)]">
              {lane.pendingDeltaEvents}{" "}
              {lane.pendingDeltaEvents === 1
                ? "evento pendente"
                : "eventos pendentes"}
            </span>
          )}
        </div>
      ) : (
        <p className="mb-2 text-[11px] text-[var(--ok-yellow)]">
          Selecione uma lane para enviar uma instrução.
        </p>
      )}

      <div className="flex items-end gap-2">
        <TextField className="min-w-0 flex-1" fullWidth>
          <Label className="sr-only">Mensagem para a lane</Label>
          <TextArea
            className="max-h-40 min-h-11 w-full resize-none rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-bg)] px-3 py-2.5 text-sm text-[var(--ok-text)] outline-none placeholder:text-[var(--ok-text-muted)] focus:border-[var(--ok-cyan)]"
            disabled={!lane || isSending}
            placeholder="Descreva o próximo passo…"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </TextField>
        {activeRunId ? (
          <Button
            className="h-11 border border-[color-mix(in_srgb,var(--ok-red)_45%,var(--ok-border))] text-[var(--ok-red)]"
            isDisabled={isCancelling}
            type="button"
            variant="ghost"
            onPress={() => void onCancel(activeRunId)}
          >
            <Square aria-hidden="true" size={14} />
            Interromper
          </Button>
        ) : (
          <Button
            className="h-11 bg-[var(--ok-orange)] font-semibold text-[var(--ok-bg)]"
            isDisabled={!lane || !input.trim() || isSending}
            type="submit"
            variant="primary"
          >
            <Send aria-hidden="true" size={14} />
            Enviar
          </Button>
        )}
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-[var(--ok-red)]" role="alert">
          {error.message}
        </p>
      )}
    </form>
  );
}
