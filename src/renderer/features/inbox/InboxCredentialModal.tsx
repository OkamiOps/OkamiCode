import { Button, Modal, useOverlayState } from "@heroui/react";
import { ExternalLink, KeyRound, ShieldCheck, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";

type InboxAccount = IpcResponse<"inbox:accounts:list">[number]["account"];
type UpdateCredentialRequest = IpcRequest<"inbox:account:updateCredential">;

export function InboxCredentialModal({
  account,
  isPending,
  onConnectGoogle,
  onSubmit,
}: {
  account: InboxAccount;
  isPending: boolean;
  onConnectGoogle: (request: { accountId: string }) => Promise<unknown>;
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
    if (isGmail) {
      try {
        await onConnectGoogle({ accountId: account.id });
        state.close();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível reconectar a Conta Google.",
        );
      }
      return;
    }
    if (!username.trim() || !password) {
      setError("Informe o usuário e a nova credencial.");
      return;
    }
    try {
      await onSubmit({
        accountId: account.id,
        credential: {
          version: 1,
          kind: "imap_password",
          username: username.trim(),
          password,
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
                  <Modal.Heading>
                    {isGmail ? "Reconectar Google" : "Atualizar acesso"}
                  </Modal.Heading>
                  <p>
                    {isGmail
                      ? `Confirme o acesso no navegador para reconectar ${account.displayName}.`
                      : `Substitua a credencial local de ${account.displayName} e teste a sincronização agora.`}
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
                {isGmail ? (
                  <div className="inbox-google-reauthorize">
                    <span className="inbox-google-reauthorize__icon">
                      <ExternalLink aria-hidden="true" size={19} />
                    </span>
                    <div>
                      <strong>Login oficial do Google</strong>
                      <p>
                        O navegador será aberto para você entrar e confirmar no
                        dispositivo. O Okami não solicita nem armazena sua
                        senha.
                      </p>
                      <small>
                        Se esta conta ainda usa a conexão antiga, você escolherá
                        uma vez o JSON “Aplicativo para computador”.
                      </small>
                    </div>
                  </div>
                ) : (
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
                      <span>Nova senha da conta</span>
                      <input
                        aria-label="Nova senha da conta"
                        autoComplete="new-password"
                        onChange={(event) => setPassword(event.target.value)}
                        type="password"
                        value={password}
                      />
                    </label>
                  </div>
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
                  {isPending
                    ? isGmail
                      ? "Aguardando Google…"
                      : "Sincronizando…"
                    : isGmail
                      ? "Entrar com Google"
                      : "Atualizar e sincronizar"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}
