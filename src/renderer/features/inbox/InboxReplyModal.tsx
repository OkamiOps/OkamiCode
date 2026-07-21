import { Button, Modal, useOverlayState } from "@heroui/react";
import { MailCheck, Send, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";

type InboxThread = IpcResponse<"inbox:threads:list">["threads"][number];
type InboxThreadDetail = IpcResponse<"inbox:thread:get">;
type CreateReplyDraftRequest = IpcRequest<"inbox:thread:createReplyDraft">;

interface InboxReplyModalProps {
  detail: InboxThreadDetail | undefined;
  isSaving: boolean;
  onCreateReplyDraft: (request: CreateReplyDraftRequest) => Promise<unknown>;
}

const maxReplyLength = 20_000;

export function InboxReplyModal({
  detail,
  isSaving,
  onCreateReplyDraft,
}: InboxReplyModalProps) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (isOpen && detail?.thread) {
        idempotencyKey.current = createUuid();
        setBody("");
        setError(null);
      }
      if (!isOpen) {
        idempotencyKey.current = null;
        setBody("");
        setError(null);
      }
    },
  });
  const thread = detail?.thread;
  const recipient = thread ? primaryParticipant(thread) : "";
  const subject = thread ? replySubject(thread.subject) : "";
  const incomingSender = detail
    ? [...detail.messages]
        .reverse()
        .find(
          (message) =>
            message.direction === "incoming" &&
            message.sender.trim().length > 0,
        )
        ?.sender.trim()
    : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!thread || isSaving) return;

    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setError("Escreva uma resposta antes de salvar.");
      return;
    }
    if (trimmedBody.length > maxReplyLength) {
      setError("A resposta pode ter no máximo 20.000 caracteres.");
      return;
    }

    setError(null);
    try {
      await onCreateReplyDraft({
        threadId: thread.id,
        body: trimmedBody,
        idempotencyKey: idempotencyKey.current ?? createUuid(),
      });
      state.close();
    } catch (cause) {
      setError(messageFor(cause, "Não foi possível salvar a resposta."));
    }
  }

  return (
    <Modal.Root state={state}>
      {thread ? (
        <Modal.Trigger
          aria-label="Responder"
          className="inbox-future-action inbox-future-action--primary"
        >
          <Send aria-hidden="true" size={14} />
          Responder
        </Modal.Trigger>
      ) : (
        <Button
          aria-label="Responder"
          className="inbox-future-action inbox-future-action--primary"
          isDisabled
          size="sm"
          variant="ghost"
        >
          <Send aria-hidden="true" size={14} />
          Responder
        </Button>
      )}
      <Modal.Backdrop className="inbox-modal-backdrop">
        <Modal.Container className="inbox-reply-modal" placement="center">
          <Modal.Dialog>
            <form onSubmit={submit}>
              <Modal.Header className="inbox-reply-modal__header">
                <span className="inbox-reply-modal__mark">
                  <MailCheck aria-hidden="true" size={16} />
                </span>
                <div>
                  <Modal.Heading>Responder por email</Modal.Heading>
                  <p>A resposta será criada para sua aprovação.</p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar resposta"
                  className="inbox-modal-close"
                >
                  <X aria-hidden="true" size={15} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="inbox-reply-modal__body">
                <div className="inbox-reply-summary">
                  <label className="inbox-form-field">
                    <span>Destinatário</span>
                    <input
                      aria-label="Destinatário"
                      readOnly
                      value={incomingSender ?? recipient}
                    />
                  </label>
                  <label className="inbox-form-field">
                    <span>Assunto</span>
                    <input aria-label="Assunto" readOnly value={subject} />
                  </label>
                </div>
                <label className="inbox-reply-field">
                  <span>Resposta</span>
                  <textarea
                    aria-label="Resposta"
                    maxLength={maxReplyLength + 1}
                    onChange={(event) => {
                      setBody(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Escreva a resposta que será enviada após aprovação…"
                    value={body}
                  />
                  <small aria-live="polite">
                    {body.length.toLocaleString("pt-BR")} / 20.000
                  </small>
                </label>
                <p className="inbox-reply-safety">
                  Salvar não envia nenhum email. A resposta fica pendente de
                  aprovação.
                </p>
                {error && (
                  <p className="inbox-form-error" role="alert">
                    {error}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="inbox-reply-modal__footer">
                <Button
                  className="inbox-reply-modal__cancel"
                  onPress={state.close}
                  size="sm"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button
                  className="inbox-reply-modal__submit"
                  isDisabled={isSaving}
                  size="sm"
                  type="submit"
                >
                  {isSaving ? "Salvando…" : "Salvar para aprovação"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function primaryParticipant(thread: InboxThread) {
  return thread.participants[0] ?? "Destinatário indisponível";
}

function replySubject(subject: string) {
  let trimmedSubject = subject.trim();
  while (/^re\s*:\s*/iu.test(trimmedSubject)) {
    trimmedSubject = trimmedSubject.replace(/^re\s*:\s*/iu, "");
  }
  return `Re: ${trimmedSubject || "(sem assunto)"}`;
}

function createUuid() {
  return globalThis.crypto.randomUUID();
}

function messageFor(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
