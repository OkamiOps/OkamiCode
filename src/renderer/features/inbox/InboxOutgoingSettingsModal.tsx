import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import { LockKeyhole, SendHorizontal, ServerCog, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";

type InboxAccount = IpcResponse<"inbox:accounts:list">[number]["account"];
type GetOutgoingSettingsRequest = IpcRequest<"inbox:account:outgoing:get">;
type GetOutgoingSettingsResponse = IpcResponse<"inbox:account:outgoing:get">;
type SetOutgoingSettingsRequest = IpcRequest<"inbox:account:outgoing:set">;

interface InboxOutgoingSettingsModalProps {
  account: InboxAccount;
  getOutgoingSettings: (
    request: GetOutgoingSettingsRequest,
  ) => Promise<GetOutgoingSettingsResponse>;
  setOutgoingSettings: (
    request: SetOutgoingSettingsRequest,
  ) => Promise<unknown>;
}

interface OutgoingForm {
  host: string;
  port: string;
  secure: boolean;
  fromAddresses: string;
}

const absentForm: OutgoingForm = {
  host: "",
  port: "465",
  secure: true,
  fromAddresses: "",
};

export function InboxOutgoingSettingsModal({
  account,
  getOutgoingSettings,
  setOutgoingSettings,
}: InboxOutgoingSettingsModalProps) {
  const [form, setForm] = useState<OutgoingForm>(absentForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (isOpen) void loadSettings();
      else loadVersion.current += 1;
    },
  });

  async function loadSettings() {
    const version = loadVersion.current + 1;
    loadVersion.current = version;
    setForm(absentForm);
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    try {
      const settings = await getOutgoingSettings({ accountId: account.id });
      if (loadVersion.current !== version) return;
      setForm(
        settings
          ? {
              host: settings.host,
              port: String(settings.port),
              secure: settings.secure,
              fromAddresses: settings.fromAddresses.join("\n"),
            }
          : absentForm,
      );
    } catch (cause) {
      if (loadVersion.current === version) {
        setLoadError(
          messageFor(cause, "Não foi possível carregar a configuração."),
        );
      }
    } finally {
      if (loadVersion.current === version) setIsLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading || isSaving || loadError) return;

    const host = form.host.trim();
    if (!host) {
      setSaveError("Informe o servidor SMTP.");
      return;
    }
    if (!/^\d+$/u.test(form.port)) {
      setSaveError("Informe uma porta entre 1 e 65535.");
      return;
    }
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setSaveError("Informe uma porta entre 1 e 65535.");
      return;
    }
    const fromAddresses = form.fromAddresses
      .split(/[\n,;]/u)
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean);
    const invalidAddress = fromAddresses.find(
      (address) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(address),
    );
    if (invalidAddress) {
      setSaveError(`O alias ${invalidAddress} não é um endereço válido.`);
      return;
    }

    setSaveError(null);
    setIsSaving(true);
    try {
      await setOutgoingSettings({
        accountId: account.id,
        configuration: {
          host,
          port,
          secure: form.secure,
          fromAddresses,
        },
      });
      state.close();
    } catch (cause) {
      setSaveError(
        messageFor(cause, "Não foi possível salvar a configuração."),
      );
    } finally {
      setIsSaving(false);
    }
  }

  const unavailable = isLoading || Boolean(loadError);

  return (
    <Modal.Root state={state}>
      <Modal.Trigger
        aria-label={`Configurar envio de ${account.displayName}`}
        className="inbox-account-action inbox-account-action--outgoing"
      >
        <SendHorizontal aria-hidden="true" size={13} />
      </Modal.Trigger>
      <Modal.Backdrop className="inbox-modal-backdrop">
        <Modal.Container
          className="inbox-outgoing-settings-modal"
          placement="center"
        >
          <Modal.Dialog>
            <form noValidate onSubmit={submit}>
              <Modal.Header className="inbox-outgoing-settings-modal__header">
                <span className="inbox-outgoing-settings-modal__mark">
                  <ServerCog aria-hidden="true" size={16} />
                </span>
                <div>
                  <Modal.Heading>Configurar envio</Modal.Heading>
                  <p>{account.displayName}</p>
                  <small>{account.address}</small>
                </div>
                <Modal.CloseTrigger
                  aria-label="Fechar configuração de envio"
                  className="inbox-modal-close"
                >
                  <X aria-hidden="true" size={15} />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="inbox-outgoing-settings-modal__body">
                {isLoading && (
                  <p
                    className="inbox-outgoing-settings-modal__state"
                    role="status"
                  >
                    <Spinner size="sm" />
                    Carregando configuração…
                  </p>
                )}
                {loadError && (
                  <div className="inbox-outgoing-settings-modal__state inbox-outgoing-settings-modal__state--error">
                    <p role="alert">{loadError}</p>
                    <Button
                      onPress={() => void loadSettings()}
                      size="sm"
                      variant="secondary"
                    >
                      Tentar novamente
                    </Button>
                  </div>
                )}
                <div className="inbox-form-grid">
                  <label className="inbox-form-field inbox-outgoing-settings-modal__host">
                    <span>Servidor SMTP</span>
                    <input
                      aria-label="Servidor SMTP"
                      disabled={unavailable}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          host: event.target.value,
                        }));
                        if (saveError) setSaveError(null);
                      }}
                      placeholder="smtp.dominio.com"
                      value={form.host}
                    />
                  </label>
                  <label className="inbox-form-field">
                    <span>Porta SMTP</span>
                    <input
                      aria-label="Porta SMTP"
                      disabled={unavailable}
                      inputMode="numeric"
                      max="65535"
                      min="1"
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          port: event.target.value,
                        }));
                        if (saveError) setSaveError(null);
                      }}
                      type="number"
                      value={form.port}
                    />
                  </label>
                </div>
                <label className="inbox-tls-toggle">
                  <input
                    aria-label="Usar TLS direto"
                    checked={form.secure}
                    disabled={unavailable}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        secure: event.target.checked,
                      }));
                      if (saveError) setSaveError(null);
                    }}
                    type="checkbox"
                  />
                  <LockKeyhole aria-hidden="true" size={13} />
                  Usar TLS direto
                </label>
                <section className="inbox-aliases-field">
                  <div className="inbox-aliases-field__primary">
                    <span>Endereço principal</span>
                    <strong>{account.address}</strong>
                  </div>
                  <label className="inbox-form-field">
                    <span>Aliases de envio</span>
                    <textarea
                      aria-label="Aliases de envio"
                      disabled={unavailable}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          fromAddresses: event.target.value,
                        }));
                        if (saveError) setSaveError(null);
                      }}
                      placeholder={
                        "contato@dominio.com\nfinanceiro@dominio.com"
                      }
                      value={form.fromAddresses}
                    />
                    <small>
                      Um endereço por linha. O servidor SMTP precisa permitir
                      cada alias.
                    </small>
                  </label>
                </section>
                <p className="inbox-outgoing-settings-modal__safety">
                  Configurar não envia email nem testa a conexão.
                </p>
                {saveError && (
                  <p className="inbox-form-error" role="alert">
                    {saveError}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="inbox-outgoing-settings-modal__footer">
                <Button
                  className="inbox-outgoing-settings-modal__cancel"
                  onPress={state.close}
                  size="sm"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button
                  className="inbox-outgoing-settings-modal__submit"
                  isDisabled={unavailable || isSaving}
                  size="sm"
                  type="submit"
                >
                  {isSaving ? "Salvando…" : "Salvar configuração"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function messageFor(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
