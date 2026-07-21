import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import { Bot, Gauge, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";

type InboxThread = IpcResponse<"inbox:threads:list">["threads"][number];
type ModelCatalog = IpcResponse<"models:list">;
type GenerateRequest = IpcRequest<"inbox:thread:generateReplyDraft">;

interface InboxAgentReplyModalProps {
  isGenerating: boolean;
  listModels: () => Promise<ModelCatalog>;
  onGenerate: (request: GenerateRequest) => Promise<unknown>;
  thread: InboxThread | undefined;
}

export function InboxAgentReplyModal({
  isGenerating,
  listModels,
  onGenerate,
  thread,
}: InboxAgentReplyModalProps) {
  const [catalog, setCatalog] = useState<ModelCatalog>([]);
  const [selectedProvider, setSelectedProvider] = useState<number | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (!isOpen) return;
      void loadCatalog();
    },
  });
  const providers = useMemo(
    () =>
      catalog
        .map((provider) => ({
          ...provider,
          models: provider.models.filter((model) => model.id.trim().length > 0),
        }))
        .filter(
          (provider) =>
            provider.routeKind !== "unavailable" && provider.models.length > 0,
        ),
    [catalog],
  );
  const provider =
    selectedProvider === null ? null : (providers[selectedProvider] ?? null);
  const model = provider?.models.find((item) => item.id === selectedModelId);
  const efforts = model?.efforts ?? [];

  async function loadCatalog() {
    setIsLoading(true);
    setError(null);
    setCatalog([]);
    setSelectedProvider(null);
    setSelectedModelId(null);
    setEffort(null);
    try {
      setCatalog(await listModels());
    } catch (cause) {
      setError(messageFor(cause, "Não foi possível carregar os runtimes."));
    } finally {
      setIsLoading(false);
    }
  }

  function chooseProvider(index: number) {
    setSelectedProvider(index);
    setSelectedModelId(null);
    setEffort(null);
    setError(null);
  }

  function chooseModel(id: string) {
    const candidate = provider?.models.find((item) => item.id === id);
    setSelectedModelId(id);
    setEffort(defaultEffort(candidate));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!thread || !provider || !model || inFlight.current || isGenerating)
      return;
    inFlight.current = true;
    setError(null);
    try {
      await onGenerate({
        threadId: thread.id,
        runtimeKind: provider.runtimeKind,
        model: model.id,
        ...(efforts.length > 0 && effort ? { effort } : {}),
      });
      state.close();
    } catch (cause) {
      setError(
        messageFor(
          cause,
          "Não foi possível gerar o rascunho. Tente novamente.",
        ),
      );
    } finally {
      inFlight.current = false;
    }
  }

  const submitDisabled =
    !thread ||
    !provider ||
    !model ||
    (efforts.length > 0 && !effort) ||
    isLoading;

  return (
    <Modal.Root state={state}>
      {thread ? (
        <Modal.Trigger
          aria-label="Pedir rascunho"
          className="inbox-future-action"
        >
          <Sparkles aria-hidden="true" size={14} />
          Pedir rascunho
        </Modal.Trigger>
      ) : (
        <Button
          aria-label="Pedir rascunho"
          className="inbox-future-action"
          isDisabled
          size="sm"
          variant="ghost"
        >
          <Sparkles aria-hidden="true" size={14} />
          Pedir rascunho
        </Button>
      )}
      <Modal.Backdrop
        className="inbox-modal-backdrop"
        isDismissable={!isGenerating}
        isKeyboardDismissDisabled={isGenerating}
      >
        <Modal.Container className="inbox-agent-reply-modal" placement="center">
          <Modal.Dialog>
            <form onSubmit={submit}>
              <Modal.Header className="inbox-agent-reply-modal__header">
                <span className="inbox-agent-reply-modal__mark">
                  <Bot aria-hidden="true" size={16} />
                </span>
                <div>
                  <Modal.Heading>Pedir rascunho</Modal.Heading>
                  <p>Escolha quem prepara a resposta para esta conversa.</p>
                </div>
                <Button
                  aria-label="Fechar pedido de rascunho"
                  className="inbox-modal-close"
                  isIconOnly
                  isDisabled={isGenerating}
                  onPress={state.close}
                  size="sm"
                  variant="ghost"
                >
                  <X aria-hidden="true" size={15} />
                </Button>
              </Modal.Header>
              <Modal.Body className="inbox-agent-reply-modal__body">
                <p className="inbox-agent-reply-modal__quota">
                  <Gauge aria-hidden="true" size={14} />
                  Esta ação usa uma turn da sua assinatura. O resultado será
                  salvo para aprovação; nenhum email será enviado.
                </p>
                {isLoading && (
                  <p className="inbox-agent-reply-modal__state" role="status">
                    <Spinner size="sm" /> Carregando catálogo…
                  </p>
                )}
                {!isLoading && providers.length === 0 && !error && (
                  <p className="inbox-agent-reply-modal__state">
                    Nenhum runtime disponível para gerar este rascunho.
                  </p>
                )}
                {providers.length > 0 && !isLoading && (
                  <fieldset className="inbox-agent-reply-modal__providers">
                    <legend>Runtime e provider</legend>
                    <div>
                      {providers.map((item, index) => (
                        <label
                          data-selected={
                            selectedProvider === index || undefined
                          }
                          key={`${item.runtimeKind}-${item.providerLabel}`}
                        >
                          <input
                            aria-label={`Provider ${item.providerLabel}`}
                            checked={selectedProvider === index}
                            name="reply-provider"
                            onChange={() => chooseProvider(index)}
                            type="radio"
                            value={`${item.runtimeKind}-${index}`}
                          />
                          <span>
                            <strong>{item.providerLabel}</strong>
                            <small>{item.runtimeKind}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {provider && (
                  <fieldset className="inbox-agent-reply-modal__models">
                    <legend>Modelo</legend>
                    <div>
                      {provider.models.map((item) => (
                        <label
                          data-selected={
                            selectedModelId === item.id || undefined
                          }
                          key={item.id}
                        >
                          <input
                            aria-label={`Modelo ${item.label}`}
                            checked={selectedModelId === item.id}
                            name="reply-model"
                            onChange={() => chooseModel(item.id)}
                            type="radio"
                            value={item.id}
                          />
                          <span>
                            <strong>{item.label}</strong>
                            {item.description && (
                              <small>{item.description}</small>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {model && efforts.length > 0 && (
                  <fieldset className="inbox-agent-reply-modal__efforts">
                    <legend>Escolha o effort</legend>
                    <div>
                      {efforts.map((item) => (
                        <label
                          data-selected={effort === item || undefined}
                          key={item}
                        >
                          <input
                            aria-label={`Effort ${item}`}
                            checked={effort === item}
                            name="reply-effort"
                            onChange={() => setEffort(item)}
                            type="radio"
                            value={item}
                          />
                          {item}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {error && (
                  <p className="inbox-agent-reply-modal__error" role="alert">
                    {error}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="inbox-agent-reply-modal__footer">
                <Button
                  className="inbox-agent-reply-modal__cancel"
                  isDisabled={isGenerating}
                  onPress={state.close}
                  size="sm"
                  variant="secondary"
                >
                  Cancelar
                </Button>
                <Button
                  className="inbox-agent-reply-modal__submit"
                  isDisabled={submitDisabled || isGenerating}
                  size="sm"
                  type="submit"
                >
                  {isGenerating ? (
                    <Spinner size="sm" />
                  ) : (
                    <Sparkles aria-hidden="true" size={14} />
                  )}
                  {isGenerating ? "Gerando…" : "Gerar rascunho"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function defaultEffort(
  model: ModelCatalog[number]["models"][number] | undefined,
) {
  if (!model?.efforts?.length) return null;
  return model.efforts.includes(model.defaultEffort ?? "")
    ? model.defaultEffort!
    : model.efforts[0]!;
}

function messageFor(cause: unknown, fallback: string) {
  if (!(cause instanceof Error) || !cause.message) return fallback;
  if (cause.message === "Selected reply-generation runtime is unavailable") {
    return "O runtime selecionado não está disponível. Escolha outra opção.";
  }
  return /[áàâãéêíóôõúç]/i.test(cause.message) ? cause.message : fallback;
}
