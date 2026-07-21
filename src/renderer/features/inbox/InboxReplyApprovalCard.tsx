import { Button, Spinner } from "@heroui/react";
import {
  BadgeCheck,
  CircleAlert,
  Clock3,
  MailCheck,
  Send,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import type { IpcResponse } from "../../../shared/contracts/ipc";

type ReplyAction = IpcResponse<"inbox:thread:replyActions:list">[number];
type ReplyDispatch = IpcResponse<"inbox:reply:approveAndSend">;

interface InboxReplyApprovalCardProps {
  action: ReplyAction;
  onApprove: (outboxId: string) => Promise<ReplyDispatch>;
  onDiscard: (outboxId: string) => Promise<unknown>;
}

export function InboxReplyApprovalCard({
  action,
  onApprove,
  onDiscard,
}: InboxReplyApprovalCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const inFlight = useRef(false);

  async function approve() {
    if (inFlight.current || action.status !== "approval_pending") return;

    inFlight.current = true;
    setError(null);
    setIsApproving(true);
    try {
      await onApprove(action.id);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      inFlight.current = false;
      setIsApproving(false);
    }
  }

  async function discard() {
    if (
      inFlight.current ||
      (action.status !== "draft" && action.status !== "approval_pending")
    )
      return;
    inFlight.current = true;
    setError(null);
    setIsDiscarding(true);
    try {
      await onDiscard(action.id);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      inFlight.current = false;
      setIsDiscarding(false);
    }
  }

  const state = cardState(action.status, isApproving);
  const isForward = action.messageType === "forward";

  return (
    <article
      aria-label={
        isForward
          ? "Aprovação de encaminhamento por email"
          : "Aprovação de resposta por email"
      }
      className="inbox-reply-approval"
      data-status={action.status}
    >
      <header className="inbox-reply-approval__header">
        <span className="inbox-reply-approval__icon">{state.icon}</span>
        <div>
          <p className="inbox-eyebrow">
            {isForward ? "Encaminhamento por email" : "Resposta por email"}
          </p>
          <h3>{state.label}</h3>
        </div>
        <span className="inbox-reply-approval__state" role="status">
          {state.detail}
        </span>
      </header>
      <dl className="inbox-reply-approval__meta">
        <div>
          <dt>De</dt>
          <dd>{action.fromAddress ?? "Endereço principal da conta"}</dd>
        </div>
        <div>
          <dt>Para</dt>
          <dd>{action.to.join(", ")}</dd>
        </div>
        <div>
          <dt>Assunto</dt>
          <dd>{action.subject}</dd>
        </div>
      </dl>
      <p className="inbox-reply-approval__body">{action.body}</p>
      {action.status === "uncertain" && (
        <p className="inbox-reply-approval__warning" role="alert">
          Não envie novamente antes de confirmar o resultado com o provedor.
        </p>
      )}
      {action.lastError && action.status !== "uncertain" && (
        <p className="inbox-reply-approval__error" role="alert">
          {action.lastError}
        </p>
      )}
      {error && (
        <p className="inbox-reply-approval__error" role="alert">
          {error}
        </p>
      )}
      {(action.status === "approval_pending" ||
        action.status === "dispatching") && (
        <div className="inbox-reply-approval__actions">
          <Button
            aria-label="Descartar rascunho"
            className="inbox-reply-approval__discard"
            isDisabled={
              isApproving || isDiscarding || action.status === "dispatching"
            }
            onPress={discard}
            size="sm"
            variant="ghost"
          >
            {isDiscarding ? (
              <Spinner size="sm" />
            ) : (
              <Trash2 aria-hidden="true" size={14} />
            )}
            {isDiscarding ? "Descartando…" : "Descartar"}
          </Button>
          <Button
            aria-label="Aprovar e enviar"
            className="inbox-reply-approval__approve"
            isDisabled={isApproving || action.status === "dispatching"}
            onPress={action.status === "approval_pending" ? approve : undefined}
            size="sm"
          >
            {isApproving || action.status === "dispatching" ? (
              <Spinner size="sm" />
            ) : (
              <Send aria-hidden="true" size={14} />
            )}
            {isApproving || action.status === "dispatching"
              ? "Enviando…"
              : "Aprovar e enviar"}
          </Button>
        </div>
      )}
    </article>
  );
}

function cardState(status: ReplyAction["status"], isApproving: boolean) {
  if (isApproving || status === "dispatching") {
    return {
      icon: <Spinner aria-label="Enviando" size="sm" />,
      label: "Enviando…",
      detail: "Envio em andamento",
    };
  }
  switch (status) {
    case "approval_pending":
      return {
        icon: <Clock3 aria-hidden="true" size={16} />,
        label: "Aguardando sua aprovação",
        detail: "Revisão necessária",
      };
    case "confirmed":
      return {
        icon: <BadgeCheck aria-hidden="true" size={16} />,
        label: "Email enviado",
        detail: "Confirmado",
      };
    case "uncertain":
      return {
        icon: <CircleAlert aria-hidden="true" size={16} />,
        label: "Resultado do envio incerto",
        detail: "Verifique o provedor",
      };
    case "draft":
      return {
        icon: <MailCheck aria-hidden="true" size={16} />,
        label: "Rascunho de email",
        detail: "Ainda não está pronto para envio",
      };
    case "failed_retryable":
    case "failed_terminal":
      return {
        icon: <CircleAlert aria-hidden="true" size={16} />,
        label: "Não foi possível enviar o email",
        detail: "Ação necessária",
      };
  }
}

function messageFor(cause: unknown) {
  if (
    cause instanceof Error &&
    cause.message === "Outgoing email is not configured"
  ) {
    return "Configure o envio SMTP desta caixa antes de enviar. O rascunho foi preservado.";
  }
  if (
    cause instanceof Error &&
    cause.message === "Reply dispatch is unavailable"
  ) {
    return "O envio não está disponível agora. O email continua aguardando aprovação.";
  }
  return cause instanceof Error && cause.message
    ? cause.message
    : "Não foi possível iniciar o envio. O email continua aguardando aprovação.";
}
