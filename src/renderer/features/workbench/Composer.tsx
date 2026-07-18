import { Button, Label, TextArea, TextField } from "@heroui/react";
import { ArrowRight, Square } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { WorkbenchLane } from "./api";
import { laneDisplayName } from "./LaneSelector";

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
  const runtime = runtimePresentation(lane);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!lane || !trimmed || isSending) return;
    await onSend(trimmed);
    setInput("");
  }

  return (
    <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
      {lane ? (
        <div aria-label="Rota efetiva da lane" className="composer-context">
          {[
            harnessLabel(lane),
            lane.providerAccountLabel,
            lane.model,
            lane.routeKind,
            lane.displayQuotaAccount,
            `${metadataValue(lane.permissionMode)} · ${metadataValue(lane.workspacePath)}`,
          ].map((label) => (
            <span className="composer-context-chip" key={label}>
              {label}
              <span aria-hidden="true">✕</span>
            </span>
          ))}
          {lane.temperature === "stale" && lane.pendingDeltaEvents > 0 && (
            <span className="composer-context-warning">
              {lane.pendingDeltaEvents}{" "}
              {lane.pendingDeltaEvents === 1
                ? "evento pendente"
                : "eventos pendentes"}
            </span>
          )}
        </div>
      ) : (
        <p className="composer-no-lane">
          Selecione uma lane para enviar uma instrução.
        </p>
      )}

      <div className="composer-box">
        <TextField className="composer-field" fullWidth>
          <Label className="sr-only">Mensagem para a lane</Label>
          <TextArea
            className="composer-textarea"
            disabled={!lane || isSending}
            placeholder={
              lane
                ? `Escreva para a lane ${laneDisplayName(lane)}…`
                : "Descreva o próximo passo…"
            }
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </TextField>
        <div className="composer-toolrow">
          {lane && (
            <span className="composer-lane-picker" title="Lane selecionada">
              <span
                aria-hidden="true"
                className={`composer-lane-glyph runtime-glyph--${runtime.tone}`}
              >
                {runtime.glyph}
              </span>
              {laneDisplayName(lane)} · {shortModel(lane.model)}
              <span className="composer-lane-picker__mode">
                {metadataValue(lane.permissionMode)}
              </span>
            </span>
          )}
          {activeRunId ? (
            <Button
              aria-label="Interromper"
              className="composer-stop"
              isDisabled={isCancelling}
              isIconOnly
              type="button"
              variant="ghost"
              onPress={() => void onCancel(activeRunId)}
            >
              <Square aria-hidden="true" size={13} />
            </Button>
          ) : (
            <Button
              aria-label="Enviar"
              className="composer-send"
              isDisabled={!lane || !input.trim() || isSending}
              isIconOnly
              type="submit"
              variant="primary"
            >
              <ArrowRight aria-hidden="true" size={15} strokeWidth={2.2} />
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="composer-error" role="alert">
          {error.message}
        </p>
      )}
    </form>
  );
}

function runtimePresentation(lane: WorkbenchLane | null) {
  if (!lane) return { glyph: "OB", tone: "task" } as const;
  const account = `${lane.providerAccountLabel} ${lane.model}`.toLowerCase();
  if (account.includes("grok")) return { glyph: "GK", tone: "grok" } as const;
  if (/chatgpt|\bgpt|\bo[134]/u.test(account)) {
    return { glyph: "GP", tone: "gpt" } as const;
  }
  return { glyph: "CL", tone: "claude" } as const;
}

function shortModel(model: string): string {
  const match = model.match(
    /(?:claude-)?(opus|sonnet|haiku)|((?:gpt|o\d)[\w.-]*)/iu,
  );
  const value = match?.[1] ?? match?.[2] ?? model;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
