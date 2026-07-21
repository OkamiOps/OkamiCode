import { Button, Modal, useOverlayState } from "@heroui/react";
import {
  Check,
  ExternalLink,
  FileJson,
  LockKeyhole,
  MailPlus,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { IpcRequest } from "../../../shared/contracts/ipc";

type AddInboxAccountRequest = IpcRequest<"inbox:account:add">;

interface InboxAccountModalProps {
  isPending: boolean;
  onSubmit: (request: AddInboxAccountRequest) => Promise<unknown>;
  onConnectGoogle: () => Promise<unknown>;
}

interface AccountForm {
  provider: "gmail" | "imap" | "zoho";
  displayName: string;
  address: string;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
}

const initialForm: AccountForm = {
  provider: "imap",
  displayName: "",
  address: "",
  host: "",
  port: "993",
  secure: true,
  username: "",
  password: "",
};

export function InboxAccountModal({
  isPending,
  onConnectGoogle,
  onSubmit,
}: InboxAccountModalProps) {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (!isOpen) {
        setForm(initialForm);
        setError(null);
      }
    },
  });

  function close() {
    state.close();
  }

  function selectProvider(provider: AccountForm["provider"]) {
    setForm((current) => ({
      ...current,
      provider,
      ...(provider === "gmail"
        ? {
            host: "imap.gmail.com",
            port: "993",
            secure: true,
            username: current.address.trim() || current.username,
          }
        : {}),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.provider === "gmail") {
      try {
        await onConnectGoogle();
        close();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível conectar a Conta Google.",
        );
      }
      return;
    }
    if (!form.displayName.trim() || !form.address.trim() || !form.host.trim()) {
      setError("Preencha nome, email e servidor IMAP.");
      return;
    }
    if (!form.username.trim() || !form.password) {
      setError("Informe usuário e senha da caixa.");
      return;
    }
    try {
      await onSubmit({
        provider: form.provider,
        displayName: form.displayName.trim(),
        address: form.address.trim(),
        configuration: {
          host: form.host.trim(),
          port: Number(form.port),
          secure: form.secure,
        },
        credential: {
          version: 1,
          kind: "imap_password",
          username: form.username.trim(),
          password: form.password,
        },
      });
      close();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível conectar a caixa.",
      );
    }
  }

  return (
    <Modal.Root state={state}>
      <Modal.Trigger aria-label="Adicionar conta" className="inbox-add-account">
        <MailPlus aria-hidden="true" size={15} />
        Adicionar conta
      </Modal.Trigger>
      <Modal.Backdrop className="inbox-modal-backdrop">
        <Modal.Container
          className="inbox-account-modal-container"
          placement="center"
        >
          <Modal.Dialog className="inbox-account-modal">
            <form data-provider={form.provider} onSubmit={submit}>
              <Modal.Header className="inbox-account-modal__header">
                <span className="inbox-account-modal__mark">
                  <Server aria-hidden="true" size={16} />
                </span>
                <div>
                  <Modal.Heading>Conectar caixa</Modal.Heading>
                  <p>
                    A credencial fica local e a caixa sincroniza ao entrar no
                    Inbox.
                  </p>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar conexão"
                  className="inbox-modal-close"
                  onPress={close}
                >
                  <X aria-hidden="true" size={15} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="inbox-account-modal__body">
                <fieldset className="inbox-account-modal__provider">
                  <legend>Provedor da caixa</legend>
                  <div className="inbox-account-modal__type">
                    <label
                      data-selected={form.provider === "gmail" || undefined}
                    >
                      <input
                        checked={form.provider === "gmail"}
                        name="provider"
                        onChange={() => selectProvider("gmail")}
                        type="radio"
                      />
                      <span>Gmail</span>
                      <small>OAuth 2.0</small>
                    </label>
                    <label
                      data-selected={form.provider === "imap" || undefined}
                    >
                      <input
                        checked={form.provider === "imap"}
                        name="provider"
                        onChange={() => selectProvider("imap")}
                        type="radio"
                      />
                      <span>IMAP</span>
                      <small>Servidor compatível</small>
                    </label>
                    <label
                      data-selected={form.provider === "zoho" || undefined}
                    >
                      <input
                        checked={form.provider === "zoho"}
                        name="provider"
                        onChange={() => selectProvider("zoho")}
                        type="radio"
                      />
                      <span>Zoho</span>
                      <small>Configuração manual</small>
                    </label>
                  </div>
                </fieldset>

                {form.provider === "gmail" ? (
                  <GoogleOAuthPanel />
                ) : (
                  <>
                    <section
                      aria-labelledby="inbox-account-identity"
                      className="inbox-account-modal__section"
                    >
                      <div className="inbox-account-modal__section-heading">
                        <h3 id="inbox-account-identity">
                          Identificação da caixa
                        </h3>
                        <p>Como ela aparecerá no Inbox.</p>
                      </div>
                      <div className="inbox-form-grid">
                        <Field label="Nome da conta">
                          <input
                            aria-label="Nome da conta"
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                displayName: event.target.value,
                              }))
                            }
                            placeholder="Projetos, pessoal, clientes…"
                            value={form.displayName}
                          />
                        </Field>
                        <Field label="Email da conta">
                          <input
                            aria-label="Email da conta"
                            inputMode="email"
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                address: event.target.value,
                                ...(current.provider === "gmail"
                                  ? { username: event.target.value }
                                  : {}),
                              }))
                            }
                            placeholder="voce@dominio.com"
                            value={form.address}
                          />
                        </Field>
                      </div>
                    </section>

                    <section
                      aria-labelledby="inbox-account-server"
                      className="inbox-account-modal__section"
                    >
                      <div className="inbox-account-modal__section-heading">
                        <h3 id="inbox-account-server">Servidor de entrada</h3>
                        <p>Informe os dados IMAP fornecidos pelo provedor.</p>
                      </div>
                      <div className="inbox-form-grid inbox-form-grid--server">
                        <Field label="Servidor IMAP">
                          <input
                            aria-label="Servidor IMAP"
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                host: event.target.value,
                              }))
                            }
                            placeholder="imap.dominio.com"
                            value={form.host}
                          />
                        </Field>
                        <Field label="Porta">
                          <input
                            aria-label="Porta IMAP"
                            max="65535"
                            min="1"
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                port: event.target.value,
                              }))
                            }
                            type="number"
                            value={form.port}
                          />
                        </Field>
                      </div>
                    </section>

                    <section
                      aria-labelledby="inbox-account-credentials"
                      className="inbox-account-modal__section"
                    >
                      <div className="inbox-account-modal__section-heading">
                        <h3 id="inbox-account-credentials">Credenciais</h3>
                        <p>Armazenadas localmente no chaveiro deste Mac.</p>
                      </div>
                      <div className="inbox-form-grid inbox-form-grid--credentials">
                        <Field label="Usuário IMAP">
                          <input
                            aria-label="Usuário IMAP"
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                username: event.target.value,
                              }))
                            }
                            placeholder="usuario@dominio.com"
                            value={form.username}
                          />
                        </Field>
                        <Field label="Senha da conta">
                          <input
                            aria-label="Senha da conta"
                            autoComplete="new-password"
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                password: event.target.value,
                              }))
                            }
                            type="password"
                            value={form.password}
                          />
                        </Field>
                      </div>
                    </section>

                    <label className="inbox-tls-toggle">
                      <input
                        checked={form.secure}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            secure: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      <LockKeyhole aria-hidden="true" size={16} />
                      <span>
                        <strong>Usar TLS seguro</strong>
                        <small>As credenciais ficam somente neste Mac.</small>
                      </span>
                    </label>
                  </>
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
                  onPress={close}
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
                    ? form.provider === "gmail"
                      ? "Aguardando Google…"
                      : "Conectando…"
                    : form.provider === "gmail"
                      ? "Escolher JSON e entrar com Google"
                      : "Conectar conta"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function GoogleOAuthPanel() {
  return (
    <section className="inbox-google-oauth" aria-label="Conexão segura Google">
      <div className="inbox-google-oauth__hero">
        <span className="inbox-google-oauth__shield">
          <ShieldCheck aria-hidden="true" size={22} />
        </span>
        <div>
          <h3>Entrar com Google</h3>
          <p>
            Use o login oficial no navegador e confirme o acesso no seu
            dispositivo. Sua senha nunca entra no Okami.
          </p>
        </div>
      </div>
      <ol className="inbox-google-oauth__steps">
        <li>
          <FileJson aria-hidden="true" size={17} />
          <span>
            <strong>Selecione o JSON</strong>
            <small>Credencial “Aplicativo para computador”.</small>
          </span>
        </li>
        <li>
          <ExternalLink aria-hidden="true" size={17} />
          <span>
            <strong>Autorize no Google</strong>
            <small>O login abre fora do app, no navegador padrão.</small>
          </span>
        </li>
        <li>
          <Check aria-hidden="true" size={17} />
          <span>
            <strong>Sincronização automática</strong>
            <small>O token é renovado localmente sem pedir sua senha.</small>
          </span>
        </li>
      </ol>
      <p className="inbox-google-oauth__privacy">
        O JSON configura o cliente OAuth; ele não contém acesso aos seus emails.
        Os tokens ficam criptografados no chaveiro deste Mac.
      </p>
    </section>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="inbox-form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
