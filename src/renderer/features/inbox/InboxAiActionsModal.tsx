import { Button, Spinner } from "@heroui/react";
import {
  Check,
  ChevronDown,
  Clipboard,
  Languages,
  ListChecks,
  MessageSquareText,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
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
  threadId: string;
  listModels: () => Promise<ModelCatalog>;
  onAnalyze: (request: AnalyzeRequest) => Promise<AnalyzeResult>;
}

interface Exchange {
  id: string;
  prompt: string;
  result: AnalyzeResult;
}

export function InboxAiActionsModal({
  threadId,
  listModels,
  onAnalyze,
}: InboxAiActionsModalProps) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalog>([]);
  const [provider, setProvider] = useState<RuntimeKind | "">("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [action, setAction] = useState<AnalyzeRequest["action"]>("summary");
  const [instructions, setInstructions] = useState<string>(
    presets[0].instructions,
  );
  const [history, setHistory] = useState<Exchange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
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

  async function showAssistant() {
    setOpen(true);
    if (catalog.length > 0 || loadingCatalog) return;
    setLoadingCatalog(true);
    setError(null);
    try {
      const next = await listModels();
      setCatalog(next);
      const available = next.filter(
        (entry) => entry.routeKind !== "unavailable" && entry.models.length > 0,
      );
      const preferred =
        available.find(
          (entry) =>
            entry.runtimeKind === "agy" &&
            entry.models.some((candidate) => /flash/i.test(candidate.label)),
        ) ?? available[0];
      const preferredModel =
        preferred?.models.find((candidate) => /flash/i.test(candidate.label)) ??
        preferred?.models[0];
      if (preferred && preferredModel) {
        setProvider(preferred.runtimeKind);
        setModel(preferredModel.id);
        setEffort(
          defaultEffort(preferredModel.efforts, preferredModel.defaultEffort),
        );
      }
    } catch {
      setError("Não foi possível carregar seus modelos.");
    } finally {
      setLoadingCatalog(false);
    }
  }

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
    if (!provider || !selectedModel || !instructions.trim() || analyzing)
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
        { id: result.generatedAt, prompt, result },
      ]);
      setAction("custom");
      setInstructions("");
    } catch {
      setError(
        "Não foi possível concluir a análise. O e-mail não foi alterado.",
      );
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

  return (
    <>
      <button
        className="inbox-ai-actions-trigger"
        onClick={() => void showAssistant()}
        type="button"
      >
        <Sparkles aria-hidden="true" size={14} />
        Ações com IA
      </button>
      {open && (
        <aside aria-label="Assistente do e-mail" className="inbox-ai-assistant">
          <header className="inbox-ai-assistant__header">
            <span className="inbox-ai-assistant__mark">
              <Sparkles aria-hidden="true" size={17} />
            </span>
            <div>
              <h2>Assistente do e-mail</h2>
              <p>Analisa esta conversa sem responder ou alterar nada.</p>
            </div>
            <Button
              aria-label="Fechar assistente do e-mail"
              className="inbox-ai-assistant__close"
              isIconOnly
              onPress={() => setOpen(false)}
              size="sm"
              variant="ghost"
            >
              <X aria-hidden="true" size={16} />
            </Button>
          </header>

          <div className="inbox-ai-assistant__scroll">
            {history.length === 0 ? (
              <div className="inbox-ai-assistant__welcome">
                <Sparkles aria-hidden="true" size={20} />
                <h3>O que você quer entender?</h3>
                <p>
                  Peça um resumo, uma tradução ou faça qualquer pergunta sobre
                  este e-mail.
                </p>
                <div aria-label="Ações rápidas" role="group">
                  {presets.map((preset) => {
                    const Icon = preset.icon;
                    return (
                      <button
                        data-selected={action === preset.action || undefined}
                        key={preset.action}
                        onClick={() => choosePreset(preset)}
                        type="button"
                      >
                        <Icon aria-hidden="true" size={14} /> {preset.label}
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
                    <div className="inbox-ai-assistant__answer">
                      <div className="inbox-ai-assistant__answer-meta">
                        <span>
                          <Check aria-hidden="true" size={14} /> Resposta
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
                      <div className="message-markdown inbox-ai-assistant__markdown">
                        <MessageMarkdown>
                          {exchange.result.content}
                        </MessageMarkdown>
                      </div>
                    </div>
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
              <p className="inbox-ai-assistant__error" role="alert">
                {error}
              </p>
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
                    setEffort(
                      defaultEffort(next?.efforts, next?.defaultEffort),
                    );
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
        </aside>
      )}
    </>
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
