import { Button, Spinner } from "@heroui/react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  Languages,
  ListChecks,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Send,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";
import type { RuntimeKind } from "../../../shared/contracts/lane";
import { MessageMarkdown } from "../workbench/MessageMarkdown";

type AnalyzeRequest = IpcRequest<"inbox:thread:analyze">;
type AnalyzeResult = IpcResponse<"inbox:thread:analyze">;
type ModelCatalog = IpcResponse<"models:list">;

const presets = [
  {
    action: "summary" as const,
    label: "Resumir",
    icon: MessageSquareText,
    instructions: "Resuma este email em português do Brasil, com objetividade.",
  },
  {
    action: "key_points" as const,
    label: "Pontos-chave",
    icon: ListChecks,
    instructions:
      "Extraia os pontos-chave, decisões, prazos e ações necessárias deste email.",
  },
  {
    action: "translate" as const,
    label: "Traduzir",
    icon: Languages,
    instructions:
      "Traduza para português do Brasil, preservando nomes, links, datas e o tom original.",
  },
] as const;

interface InboxAiActionsModalProps {
  open: boolean;
  threadId: string;
  listModels: () => Promise<ModelCatalog>;
  onAnalyze: (request: AnalyzeRequest) => Promise<AnalyzeResult>;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

interface Exchange {
  id: string;
  prompt: string;
  result: AnalyzeResult;
  providerLabel: string;
  modelLabel: string;
}

interface AnalysisError {
  providerLabel: string;
  modelLabel: string;
  detail: string;
}

export function InboxAiActionsModal({
  open,
  threadId,
  listModels,
  onAnalyze,
  onClose,
  expanded,
  onToggleExpanded,
}: InboxAiActionsModalProps) {
  const [catalog, setCatalog] = useState<ModelCatalog>([]);
  const [provider, setProvider] = useState<RuntimeKind | "">("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [action, setAction] = useState<AnalyzeRequest["action"]>("custom");
  const [instructions, setInstructions] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [error, setError] = useState<AnalysisError | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const providers = useMemo(
    () =>
      catalog.filter(
        (entry) => entry.routeKind !== "unavailable" && entry.models.length > 0,
      ),
    [catalog],
  );
  const selectedProvider = providers.find(
    (entry) => entry.runtimeKind === provider,
  );
  const selectedModel = selectedProvider?.models.find(
    (entry) => entry.id === model,
  );
  const efforts = selectedModel?.efforts ?? [];
  const loadingCatalog = open && catalog.length === 0 && error === null;

  useEffect(() => {
    if (!open || catalog.length > 0) return;
    let active = true;
    void listModels()
      .then((next) => {
        if (!active) return;
        setCatalog(next);
        const available = next.filter(
          (entry) =>
            entry.routeKind !== "unavailable" && entry.models.length > 0,
        );
        const preferred =
          available.find((entry) => entry.runtimeKind === "codex") ??
          available.find((entry) => entry.runtimeKind === "claude") ??
          available[0];
        const preferredModel = preferred?.models[0];
        if (preferred && preferredModel) {
          setProvider(preferred.runtimeKind);
          setModel(preferredModel.id);
          setEffort(
            defaultEffort(preferredModel.efforts, preferredModel.defaultEffort),
          );
        }
      })
      .catch(() => {
        if (active) {
          setError({
            providerLabel: "Catálogo local",
            modelLabel: "Modelos",
            detail: "Não foi possível carregar seus modelos.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [catalog.length, listModels, open]);

  function choosePreset(next: (typeof presets)[number]) {
    setAction(next.action);
    setInstructions(next.instructions);
    setError(null);
  }

  function chooseProvider(runtimeKind: RuntimeKind) {
    const nextProvider = providers.find(
      (entry) => entry.runtimeKind === runtimeKind,
    );
    const nextModel = nextProvider?.models[0];
    setProvider(runtimeKind);
    setModel(nextModel?.id ?? "");
    setEffort(defaultEffort(nextModel?.efforts, nextModel?.defaultEffort));
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (
      !provider ||
      !selectedProvider ||
      !selectedModel ||
      !instructions.trim() ||
      analyzing
    )
      return;
    const prompt = instructions.trim();
    setAnalyzing(true);
    setError(null);
    try {
      const result = await onAnalyze({
        threadId,
        runtimeKind: provider,
        model: selectedModel.id,
        action,
        instructions: prompt,
        ...(effort ? { effort } : {}),
      });
      setHistory((current) => [
        ...current,
        {
          id: result.generatedAt,
          prompt,
          result,
          providerLabel: selectedProvider.providerLabel,
          modelLabel: selectedModel.label,
        },
      ]);
      setAction("custom");
      setInstructions("");
    } catch (cause) {
      const providerName = selectedProvider?.providerLabel ?? provider;
      const modelName = selectedModel.label;
      setError({
        providerLabel: providerName,
        modelLabel: modelName,
        detail: analysisErrorDetail(cause),
      });
    } finally {
      setAnalyzing(false);
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return;
    event.preventDefault();
    void submit();
  }

  if (!open) return null;

  return (
    <div
      className="inbox-ai-assistant"
      data-expanded={expanded || undefined}
      data-provider={provider || undefined}
    >
      <header className="inbox-ai-assistant__header">
        <span className="inbox-ai-assistant__mark">
          <Sparkles aria-hidden="true" size={17} />
        </span>
        <div>
          <h2>Assistente do e-mail</h2>
          <p>Analisa esta conversa sem responder ou alterar nada.</p>
        </div>
        <div className="inbox-ai-assistant__header-actions">
          <Button
            aria-label={expanded ? "Reduzir assistente" : "Expandir assistente"}
            className="inbox-ai-assistant__expand"
            isIconOnly
            onPress={onToggleExpanded}
            size="sm"
            variant="ghost"
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" size={16} />
            ) : (
              <Maximize2 aria-hidden="true" size={16} />
            )}
          </Button>
          <Button
            aria-label="Fechar assistente do e-mail"
            className="inbox-ai-assistant__close"
            isIconOnly
            onPress={onClose}
            size="sm"
            variant="ghost"
          >
            <X aria-hidden="true" size={16} />
          </Button>
        </div>
      </header>

      <div className="inbox-ai-assistant__scroll">
        {history.length === 0 ? (
          <div className="inbox-ai-assistant__welcome">
            <span className="inbox-ai-assistant__welcome-mark">
              <WandSparkles aria-hidden="true" size={22} />
            </span>
            <span className="inbox-ai-assistant__eyebrow">
              Leitura inteligente
            </span>
            <h3>O que você quer entender?</h3>
            <p>
              Peça um resumo, uma tradução ou faça qualquer pergunta sobre este
              e-mail.
            </p>
            <div
              className="inbox-ai-assistant__presets"
              aria-label="Ações rápidas"
              role="group"
            >
              {presets.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    data-selected={action === preset.action || undefined}
                    key={preset.action}
                    onClick={() => choosePreset(preset)}
                    type="button"
                  >
                    <span>
                      <Icon aria-hidden="true" size={15} />
                    </span>
                    <strong>{preset.label}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="inbox-ai-assistant__history" aria-live="polite">
            {history.map((exchange) => (
              <section key={exchange.id}>
                <p className="inbox-ai-assistant__prompt-bubble">
                  {exchange.prompt}
                </p>
                <article
                  aria-label="Resposta da IA"
                  className="inbox-ai-assistant__answer"
                >
                  <div className="inbox-ai-assistant__answer-meta">
                    <span>
                      <Check aria-hidden="true" size={14} /> Resposta gerada
                    </span>
                    <button
                      aria-label="Copiar resposta"
                      onClick={() => {
                        void copyText(exchange.result.content).then(() => {
                          setCopiedId(exchange.id);
                          window.setTimeout(() => setCopiedId(null), 1_500);
                        });
                      }}
                      type="button"
                    >
                      <Clipboard aria-hidden="true" size={13} />
                      {copiedId === exchange.id ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  <div className="inbox-ai-assistant__runtime-chip">
                    <Bot aria-hidden="true" size={13} />
                    <span>{exchange.providerLabel}</span>
                    <span aria-hidden="true">·</span>
                    <strong>{exchange.modelLabel}</strong>
                  </div>
                  <div className="message-markdown inbox-ai-assistant__markdown">
                    <MessageMarkdown>{exchange.result.content}</MessageMarkdown>
                  </div>
                </article>
              </section>
            ))}
          </div>
        )}
        {analyzing && (
          <div className="inbox-ai-assistant__thinking" role="status">
            <Spinner size="sm" /> Analisando com{" "}
            {selectedProvider?.providerLabel}…
          </div>
        )}
        {error && (
          <section className="inbox-ai-assistant__error" role="alert">
            <span className="inbox-ai-assistant__error-icon">
              <AlertTriangle aria-hidden="true" size={18} />
            </span>
            <div>
              <span className="inbox-ai-assistant__error-kicker">
                Execução interrompida
              </span>
              <h3>Este provider não respondeu</h3>
              <p>{error.detail}</p>
              <div className="inbox-ai-assistant__error-runtime">
                <span>{error.providerLabel}</span>
                <span>{error.modelLabel}</span>
              </div>
              {providers.some((entry) => entry.runtimeKind === "codex") &&
                provider !== "codex" && (
                  <button onClick={() => chooseProvider("codex")} type="button">
                    Usar ChatGPT recomendado
                  </button>
                )}
            </div>
          </section>
        )}
      </div>

      <form className="inbox-ai-assistant__composer" onSubmit={submit}>
        <textarea
          aria-label="O que você quer saber?"
          maxLength={4_000}
          onChange={(event) => {
            setInstructions(event.target.value);
            setAction("custom");
            setError(null);
          }}
          onKeyDown={handlePromptKeyDown}
          placeholder="Pergunte algo sobre este e-mail…"
          value={instructions}
        />
        <div className="inbox-ai-assistant__controls">
          <label>
            <span className="sr-only">Provider</span>
            <select
              aria-label="Provider"
              disabled={loadingCatalog}
              onChange={(event) =>
                chooseProvider(event.target.value as RuntimeKind)
              }
              value={provider}
            >
              <option value="">Provider</option>
              {providers.map((entry) => (
                <option key={entry.runtimeKind} value={entry.runtimeKind}>
                  {entry.providerLabel}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" size={13} />
          </label>
          <label>
            <span className="sr-only">Modelo</span>
            <select
              aria-label="Modelo"
              onChange={(event) => {
                const next = selectedProvider?.models.find(
                  (candidate) => candidate.id === event.target.value,
                );
                setModel(event.target.value);
                setEffort(defaultEffort(next?.efforts, next?.defaultEffort));
              }}
              value={model}
            >
              <option value="">Modelo</option>
              {selectedProvider?.models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" size={13} />
          </label>
          {efforts.length > 0 && (
            <label className="inbox-ai-assistant__effort">
              <span className="sr-only">Effort</span>
              <select
                aria-label="Effort"
                onChange={(event) => setEffort(event.target.value)}
                value={effort}
              >
                {efforts.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" size={13} />
            </label>
          )}
          <Button
            aria-label="Enviar para análise"
            className="inbox-ai-assistant__send"
            isDisabled={
              !provider || !model || !instructions.trim() || analyzing
            }
            isIconOnly
            type="submit"
          >
            {analyzing ? (
              <Spinner size="sm" />
            ) : (
              <Send aria-hidden="true" size={16} />
            )}
          </Button>
        </div>
        <p>Enter para enviar · Shift + Enter para nova linha</p>
      </form>
    </div>
  );
}

function defaultEffort(
  efforts: string[] | undefined,
  preferred?: string,
): string {
  if (!efforts?.length) return "";
  if (preferred && efforts.includes(preferred)) return preferred;
  return efforts.includes("medium") ? "medium" : efforts[0]!;
}

function analysisErrorDetail(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (
    message.includes("not supported model") ||
    message.includes("model is not supported") ||
    message.includes("not supported by this plan") ||
    message.includes("model is unavailable")
  ) {
    return "O plano conectado não aceitou este modelo. Escolha outro modelo do mesmo provider ou tente o automático.";
  }
  if (
    message.includes("quota") ||
    message.includes("limit") ||
    message.includes("capacity")
  ) {
    return "A cota deste provider está indisponível ou atingiu o limite atual. Nenhuma ação foi feita no e-mail.";
  }
  if (message.includes("protocol") || message.includes("capabilit")) {
    return "A versão instalada do CLI não confirmou o protocolo necessário. Atualize o provider ou escolha outro modelo.";
  }
  return "A execução terminou antes de entregar uma resposta válida. Tente novamente ou escolha outro provider. O e-mail não foi alterado.";
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement("textarea");
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}
