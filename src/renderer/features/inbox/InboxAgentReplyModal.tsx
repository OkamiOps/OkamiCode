import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import {
  Bot,
  ChevronDown,
  Gauge,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import { InboxSenderIdentityField } from "./InboxSenderIdentityField";

type InboxThread = IpcResponse<"inbox:threads:list">["threads"][number];
type ModelCatalog = IpcResponse<"models:list">;
type GenerateRequest = IpcRequest<"inbox:thread:generateReplyDraft">;
type ReplyCatalogEntry = ModelCatalog[number] & {
  runtimeKind: GenerateRequest["runtimeKind"];
};

function supportsReplyGeneration(
  provider: ModelCatalog[number],
): provider is ReplyCatalogEntry {
  return provider.runtimeKind.length > 0;
}

function providerKey(provider: ReplyCatalogEntry) {
  return `${provider.runtimeKind}:${provider.providerLabel}`;
}

interface InboxAgentReplyModalProps {
  defaultFromAddress: string;
  isGenerating: boolean;
  fromAddresses: string[];
  fromAddressesError: string | null;
  isLoadingFromAddresses: boolean;
  listModels: () => Promise<ModelCatalog>;
  onGenerate: (request: GenerateRequest) => Promise<unknown>;
  thread: InboxThread | undefined;
}

export function InboxAgentReplyModal({
  defaultFromAddress,
  fromAddresses,
  fromAddressesError,
  isLoadingFromAddresses,
  isGenerating,
  listModels,
  onGenerate,
  thread,
}: InboxAgentReplyModalProps) {
  const [catalog, setCatalog] = useState<ModelCatalog>([]);
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [effort, setEffort] = useState<string | null>(null);
  const [fromAddress, setFromAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      if (!isOpen) return;
      setFromAddress(defaultFromAddress || fromAddresses[0] || "");
      setInstructions("");
      void loadCatalog();
    },
  });
  const providers = useMemo(
    () =>
      catalog
        .filter(supportsReplyGeneration)
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
    providers.find(
      (candidate) => providerKey(candidate) === selectedProviderKey,
    ) ?? null;
  const model = provider?.models.find((item) => item.id === selectedModelId);
  const efforts = model?.efforts ?? [];
  const visibleModels = (() => {
    const models = provider?.models ?? [];
    const query = modelQuery.trim().toLocaleLowerCase("pt-BR");
    if (!query) return models;
    return models.filter((item) =>
      `${item.label} ${item.id}`.toLocaleLowerCase("pt-BR").includes(query),
    );
  })();

  async function loadCatalog() {
    setIsLoading(true);
    setError(null);
    setCatalog([]);
    setSelectedProviderKey("");
    setSelectedModelId(null);
    setModelQuery("");
    setEffort(null);
    try {
      setCatalog(await listModels());
    } catch (cause) {
      setError(messageFor(cause, "Não foi possível carregar os runtimes."));
    } finally {
      setIsLoading(false);
    }
  }

  function chooseProvider(key: string) {
    setSelectedProviderKey(key);
    setSelectedModelId(null);
    setModelQuery("");
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
        fromAddress,
        instructions: instructions.trim(),
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
    !fromAddress ||
    instructions.trim().length === 0 ||
    (efforts.length > 0 && !effort) ||
    isLoading;

  return (
    <Modal.Root state={state}>
      {thread ? (
        <Modal.Trigger
          aria-label="Pedir rascunho"
          className="inbox-future-action inbox-future-action--agent"
        >
          <Sparkles aria-hidden="true" size={14} />
          Rascunho IA
        </Modal.Trigger>
      ) : (
        <Button
          aria-label="Pedir rascunho"
          className="inbox-future-action inbox-future-action--agent"
          isDisabled
          size="sm"
          variant="ghost"
        >
          <Sparkles aria-hidden="true" size={14} />
          Rascunho IA
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
                  <span className="inbox-workflow-modal__eyebrow">
                    Assistente de escrita
                  </span>
                  <Modal.Heading>Pedir rascunho</Modal.Heading>
                  <p>
                    Oriente a resposta e escolha a assinatura que fará o
                    trabalho.
                  </p>
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
                <div className="inbox-workflow-modal__main">
                  <section className="inbox-workflow-modal__section">
                    <header>
                      <span>01</span>
                      <div>
                        <h3>Briefing da resposta</h3>
                        <p>
                          Escreva como quer responder, não apenas o assunto.
                        </p>
                      </div>
                    </header>
                    <label className="inbox-agent-reply-modal__instructions">
                      <span>
                        <MessageSquareText aria-hidden="true" size={14} />O que
                        você quer responder?
                      </span>
                      <textarea
                        aria-label="O que você quer responder?"
                        maxLength={4_000}
                        onChange={(event) => {
                          setInstructions(event.target.value);
                          setError(null);
                        }}
                        placeholder="Ex.: agradeça o contato, confirme o prazo de cinco dias e peça o briefing."
                        required
                        value={instructions}
                      />
                      <small>
                        <span>
                          Use tom, pontos obrigatórios e o próximo passo.
                        </span>
                        <span>{instructions.length}/4000</span>
                      </small>
                    </label>
                  </section>
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
                    <section className="inbox-workflow-modal__section">
                      <header>
                        <span>02</span>
                        <div>
                          <h3>Quem prepara</h3>
                          <p>
                            Provider, modelo e esforço ficam visíveis antes de
                            usar a cota.
                          </p>
                        </div>
                      </header>
                      <div
                        className="inbox-agent-reply-modal__configuration"
                        data-has-effort={efforts.length > 0 || undefined}
                      >
                        <CompactSelect
                          icon={<Bot aria-hidden="true" size={13} />}
                          label="Agente"
                          onChange={chooseProvider}
                          options={providers.map((item) => ({
                            label: `${item.providerLabel} · ${item.runtimeKind}`,
                            value: providerKey(item),
                          }))}
                          placeholder="Selecionar agente"
                          value={selectedProviderKey}
                        />
                        <div className="inbox-agent-reply-modal__model-picker">
                          {(provider?.models.length ?? 0) > 10 && (
                            <label>
                              <span>Buscar modelo</span>
                              <input
                                aria-label="Buscar modelo"
                                onChange={(event) =>
                                  setModelQuery(event.target.value)
                                }
                                placeholder="Digite nome ou ID…"
                                type="search"
                                value={modelQuery}
                              />
                            </label>
                          )}
                          <CompactSelect
                            disabled={!provider}
                            icon={<Sparkles aria-hidden="true" size={13} />}
                            label="Modelo"
                            onChange={chooseModel}
                            options={visibleModels.map((item) => ({
                              label: item.label,
                              value: item.id,
                            }))}
                            placeholder={
                              visibleModels.length === 0
                                ? "Nenhum modelo encontrado"
                                : "Selecionar modelo"
                            }
                            value={selectedModelId ?? ""}
                          />
                        </div>
                        {efforts.length > 0 && (
                          <CompactSelect
                            icon={<Gauge aria-hidden="true" size={13} />}
                            label="Effort"
                            onChange={setEffort}
                            options={efforts.map((item) => ({
                              label: item,
                              value: item,
                            }))}
                            placeholder="Selecionar effort"
                            value={effort ?? ""}
                          />
                        )}
                      </div>
                    </section>
                  )}
                  {model?.description && (
                    <p className="inbox-agent-reply-modal__model-description">
                      {model.description}
                    </p>
                  )}
                  <InboxSenderIdentityField
                    addresses={fromAddresses}
                    disabled={
                      isLoadingFromAddresses || fromAddresses.length === 0
                    }
                    error={fromAddressesError}
                    onChange={setFromAddress}
                    value={fromAddress}
                  />
                  {error && (
                    <p className="inbox-agent-reply-modal__error" role="alert">
                      {error}
                    </p>
                  )}
                </div>
                <aside className="inbox-workflow-modal__aside">
                  <div className="inbox-workflow-modal__source">
                    <span className="inbox-workflow-modal__source-icon inbox-workflow-modal__source-icon--violet">
                      <Mail aria-hidden="true" size={17} />
                    </span>
                    <span className="inbox-workflow-modal__eyebrow">
                      Respondendo a
                    </span>
                    <strong>{thread?.subject || "Sem assunto"}</strong>
                    <small>
                      {thread?.participants[0] || "Remetente indisponível"}
                    </small>
                    <p>{thread?.snippet || "Sem prévia disponível."}</p>
                  </div>
                  <div className="inbox-workflow-modal__outcome inbox-workflow-modal__outcome--violet">
                    <span className="inbox-workflow-modal__eyebrow">
                      Revisão protegida
                    </span>
                    <div>
                      <ShieldCheck aria-hidden="true" size={16} />
                      <span>
                        <strong>Nada será enviado agora</strong>
                        <small>
                          O resultado fica salvo para sua aprovação.
                        </small>
                      </span>
                    </div>
                    <div>
                      <Gauge aria-hidden="true" size={16} />
                      <span>
                        <strong>Usa uma turn da assinatura escolhida</strong>
                        <small>
                          {model
                            ? `${provider?.providerLabel} · ${model.label}`
                            : "Escolha provider e modelo ao lado."}
                        </small>
                      </span>
                    </div>
                  </div>
                </aside>
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

interface CompactSelectProps {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder: string;
  value: string;
}

function CompactSelect({
  disabled = false,
  icon,
  label,
  onChange,
  options,
  placeholder,
  value,
}: CompactSelectProps) {
  return (
    <label className="inbox-agent-reply-modal__select">
      <span>{label}</span>
      <span className="inbox-agent-reply-modal__select-control">
        {icon}
        <select
          aria-label={label}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" size={13} />
      </span>
    </label>
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
