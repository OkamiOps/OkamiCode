import { Button, Modal, useOverlayState } from "@heroui/react";
import { KeyRound, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";

type InboxAccount = IpcResponse<"inbox:accounts:list">[number]["account"];
type UpdateCredentialRequest = IpcRequest<"inbox:account:updateCredential">;

export function InboxCredentialModal({
  account,
  isPending,
  onSubmit,
}: {
  account: InboxAccount;
  isPending: boolean;
  onSubmit: (request: UpdateCredentialRequest) => Promise<unknown>;
}) {
  const isGmail = account.provider === "gmail";
  const [username, setUsername] = useState(account.address);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (!isOpen) {
        setUsername(account.address);
        setPassword("");
        setError(null);
      }
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPassword = isGmail
      ? password.replace(/\s+/gu, "")
      : password;
    if (!username.trim() || !normalizedPassword) {
      setError("Informe o usuário e a nova credencial.");
      return;
    }
    if (isGmail && normalizedPassword.length !== 16) {
      setError("A senha de app do Google deve ter 16 caracteres.");
      return;
    }
    try {
      await onSubmit({
        accountId: account.id,
        credential: {
          version: 1,
          kind: "imap_password",
          username: username.trim(),
          password: normalizedPassword,
        },
      });
      state.close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar o acesso.",
      );
    }
  }

  return (
    <Modal.Root state={state}>
      <Modal.Trigger
        aria-label={`Atualizar acesso de ${account.displayName}`}
        className="inbox-account-action"
      >
        <KeyRound aria-hidden="true" size={13} />
      </Modal.Trigger>
      <Modal.Backdrop className="inbox-modal-backdrop">
        <Modal.Container
          className="inbox-account-modal-container inbox-credential-modal-container"
          placement="center"
        >
          <Modal.Dialog className="inbox-account-modal inbox-credential-modal">
            <form onSubmit={submit}>
              <Modal.Header className="inbox-account-modal__header">
                <span className="inbox-account-modal__mark">
                  <KeyRound aria-hidden="true" size={16} />
                </span>
                <div>
                  <Modal.Heading>Atualizar acesso</Modal.Heading>
                  <p>
                    Substitua a credencial local de {account.displayName} e
                    teste a sincronização agora.
                  </p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar atualização de acesso"
                  className="inbox-modal-close"
                  onPress={() => state.close()}
                >
                  <X aria-hidden="true" size={15} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="inbox-account-modal__body">
                <div className="inbox-credential-account">
                  <ShieldCheck aria-hidden="true" size={17} />
                  <span>
                    <strong>{account.displayName}</strong>
                    <small>{account.address}</small>
                  </span>
                </div>
                <div className="inbox-form-grid inbox-form-grid--credentials">
                  <label className="inbox-form-field">
                    <span>Usuário IMAP</span>
                    <input
                      aria-label="Usuário IMAP"
                      onChange={(event) => setUsername(event.target.value)}
                      value={username}
                    />
                  </label>
                  <label className="inbox-form-field">
                    <span>
                      {isGmail
                        ? "Senha de app do Google"
                        : "Nova senha da conta"}
                    </span>
                    <input
                      aria-label={
                        isGmail
                          ? "Senha de app do Google"
                          : "Nova senha da conta"
                      }
                      autoComplete="new-password"
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      value={password}
                    />
                  </label>
                </div>
                {isGmail && (
                  <p className="inbox-account-modal__credential-help">
                    Use o código de 16 caracteres criado em Segurança → Senhas
                    de app da sua Conta Google. Espaços são removidos
                    automaticamente. Não use a senha normal do Gmail.{" "}
                    <a
                      href="https://support.google.com/accounts/answer/185833"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Abrir instruções oficiais
                    </a>
                  </p>
                )}
                {error && (
                  <p className="inbox-form-error" role="alert">
                    {error}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="inbox-account-modal__footer">
                <Button
                  className="inbox-account-modal__cancel"
                  onPress={() => state.close()}
                  size="sm"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button
                  className="inbox-account-modal__submit"
                  isDisabled={isPending}
                  size="sm"
                  type="submit"
                >
                  {isPending ? "Sincronizando…" : "Atualizar e sincronizar"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}
