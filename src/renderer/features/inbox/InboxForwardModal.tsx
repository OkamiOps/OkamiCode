import { Button, Modal, useOverlayState } from "@heroui/react";
import { Forward, MailOpen, Paperclip, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { InboxSenderIdentityField } from "./InboxSenderIdentityField";

type InboxThreadDetail = IpcResponse<"inbox:thread:get">;
type CreateForwardDraftRequest = IpcRequest<"inbox:thread:createForwardDraft">;

interface InboxForwardModalProps {
  detail: InboxThreadDetail | undefined;
  isSaving: boolean;
  fromAddresses: string[];
  defaultFromAddress: string;
  fromAddressesError: string | null;
  isLoadingFromAddresses: boolean;
  onCreateForwardDraft: (
    request: CreateForwardDraftRequest,
  ) => Promise<unknown>;
}

const maxNoteLength = 20_000;

export function InboxForwardModal({
  defaultFromAddress,
  detail,
  fromAddresses,
  fromAddressesError,
  isLoadingFromAddresses,
  isSaving,
  onCreateForwardDraft,
}: InboxForwardModalProps) {
  const [fromAddress, setFromAddress] = useState("");
  const [recipients, setRecipients] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (isOpen && detail?.thread) {
        idempotencyKey.current = createUuid();
        setFromAddress(defaultFromAddress || fromAddresses[0] || "");
        setRecipients("");
        setNote("");
        setError(null);
      }
      if (!isOpen) {
        idempotencyKey.current = null;
        setFromAddress("");
        setRecipients("");
        setNote("");
        setError(null);
      }
    },
  });
  const source = detail
    ? [...detail.messages]
        .reverse()
        .find(
          (message) =>
            message.externalMessageId.trim().length > 0 &&
            message.body.trim().length > 0,
        )
    : undefined;
  const subject = detail ? forwardSubject(detail.thread.subject) : "";
  const attachments = source?.attachments.length ?? 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || isSaving) return;
    if (!fromAddress) {
      setError("Escolha o endereço que enviará o encaminhamento.");
      return;
    }
    const to = parseRecipients(recipients);
    if (!to) {
      setError("Informe pelo menos um destinatário válido.");
      return;
    }
    const trimmedNote = note.trim();
    if (trimmedNote.length > maxNoteLength) {
      setError("A nota pode ter no máximo 20.000 caracteres.");
      return;
    }
    setError(null);
    try {
      await onCreateForwardDraft({
        threadId: detail.thread.id,
        fromAddress,
        to,
        ...(trimmedNote ? { note: trimmedNote } : {}),
        idempotencyKey: idempotencyKey.current ?? createUuid(),
      });
      state.close();
    } catch (cause) {
      setError(messageFor(cause));
    }
  }

  return (
    <Modal.Root state={state}>
      {detail ? (
        <Modal.Trigger
          aria-label="Encaminhar"
          className="inbox-future-action inbox-future-action--forward"
        >
          <Forward aria-hidden="true" size={14} />
          Encaminhar
        </Modal.Trigger>
      ) : (
        <Button
          aria-label="Encaminhar"
          className="inbox-future-action inbox-future-action--forward"
          isDisabled
          size="sm"
          variant="ghost"
        >
          <Forward aria-hidden="true" size={14} />
          Encaminhar
        </Button>
      )}
      <Modal.Backdrop className="inbox-modal-backdrop">
        <Modal.Container className="inbox-forward-modal" placement="center">
          <Modal.Dialog>
            <form onSubmit={submit}>
              <Modal.Header className="inbox-forward-modal__header">
                <span className="inbox-forward-modal__mark">
                  <MailOpen aria-hidden="true" size={16} />
                </span>
                <div>
                  <Modal.Heading>Encaminhar email</Modal.Heading>
                  <p>A mensagem mais recente será incluída após sua nota.</p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar encaminhamento"
                  className="inbox-modal-close"
                >
                  <X aria-hidden="true" size={15} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="inbox-forward-modal__body">
                <InboxSenderIdentityField
                  addresses={fromAddresses}
                  disabled={
                    isLoadingFromAddresses || fromAddresses.length === 0
                  }
                  error={fromAddressesError}
                  onChange={setFromAddress}
                  value={fromAddress}
                />
                <label className="inbox-form-field inbox-forward-recipient">
                  <span>Destinatários</span>
                  <input
                    aria-label="Destinatários"
                    autoComplete="off"
                    onChange={(event) => {
                      setRecipients(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="nome@empresa.com, financeiro@empresa.com"
                    value={recipients}
                  />
                  <small>Separe vários endereços por vírgula.</small>
                </label>
                <label className="inbox-form-field">
                  <span>Assunto</span>
                  <input aria-label="Assunto" readOnly value={subject} />
                </label>
                <label className="inbox-reply-field inbox-forward-note">
                  <span>Nota antes da mensagem</span>
                  <textarea
                    aria-label="Nota antes da mensagem"
                    maxLength={maxNoteLength + 1}
                    onChange={(event) => {
                      setNote(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="Adicione contexto para quem vai receber…"
                    value={note}
                  />
                  <small aria-live="polite">
                    {note.length.toLocaleString("pt-BR")} / 20.000
                  </small>
                </label>
                <div className="inbox-forward-source">
                  <span className="inbox-forward-source__icon">
                    <MailOpen aria-hidden="true" size={15} />
                  </span>
                  <span>
                    <strong>Mensagem incluída</strong>
                    <small>
                      {source?.sender || "Remetente indisponível"} ·{" "}
                      {source?.bodyFormat === "html" ? "HTML" : "Texto"}
                    </small>
                  </span>
                </div>
                <p className="inbox-forward-attachment-note">
                  <Paperclip aria-hidden="true" size={13} />
                  {attachments > 0
                    ? `Anexos do email original não serão incluídos (${attachments}).`
                    : "O encaminhamento não possui anexos para retransmitir."}
                </p>
                <p className="inbox-reply-safety">
                  Salvar não envia o email. O encaminhamento ficará aguardando
                  sua aprovação.
                </p>
                {error && (
                  <p className="inbox-form-error" role="alert">
                    {error}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="inbox-forward-modal__footer">
                <Button
                  className="inbox-forward-modal__cancel"
                  onPress={state.close}
                  size="sm"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button
                  className="inbox-forward-modal__submit"
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

function parseRecipients(value: string): string[] | null {
  const recipients = [
    ...new Set(
      value
        .split(/[;,\n]/u)
        .map((recipient) => recipient.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return recipients.length > 0 &&
    recipients.length <= 20 &&
    recipients.every(
      (recipient) =>
        recipient.length <= 320 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient),
    )
    ? recipients
    : null;
}

function forwardSubject(subject: string) {
  let normalized = subject.trim();
  while (/^(?:re|fwd?|enc)\s*:\s*/iu.test(normalized)) {
    normalized = normalized.replace(/^(?:re|fwd?|enc)\s*:\s*/iu, "");
  }
  return `Enc: ${normalized || "(sem assunto)"}`;
}

function createUuid() {
  return globalThis.crypto.randomUUID();
}

function messageFor(cause: unknown) {
  return cause instanceof Error && cause.message
    ? cause.message
    : "Não foi possível salvar o encaminhamento.";
}
