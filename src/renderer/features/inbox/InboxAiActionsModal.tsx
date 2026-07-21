import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import {
  Check,
  ChevronDown,
  Clipboard,
  Languages,
  ListChecks,
  MessageSquareText,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { IpcRequest, IpcResponse } from "../../../shared/contracts/ipc";

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

export function InboxAiActionsModal({
  threadId,
  listModels,
  onAnalyze,
}: InboxAiActionsModalProps) {
  const [catalog, setCatalog] = useState<ModelCatalog>([]);
  const [route, setRoute] = useState("");
  const [effort, setEffort] = useState("");
  const [action, setAction] = useState<AnalyzeRequest["action"]>("summary");
  const [instructions, setInstructions] = useState<string>(
    presets[0].instructions,
  );
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [copied, setCopied] = useState(false);
  const state = useOverlayState({
    onOpenChange: (open) => {
      if (!open || catalog.length > 0 || loadingCatalog) return;
      void loadCatalog();
    },
  });
  const routes = useMemo(
    () =>
      catalog.flatMap((provider) =>
        provider.runtimeKind === "claude" || provider.runtimeKind === "codex"
          ? provider.models.map((model) => ({
              runtimeKind:
                provider.runtimeKind as AnalyzeRequest["runtimeKind"],
              providerLabel: provider.providerLabel,
              model,
              value: `${provider.runtimeKind}:${model.id}`,
            }))
          : [],
      ),
    [catalog],
  );
  const selected = routes.find((candidate) => candidate.value === route);
  const efforts = selected?.model.efforts ?? [];

  async function loadCatalog() {
    setLoadingCatalog(true);
    setError(null);
    try {
      const next = await listModels();
      setCatalog(next);
      const first = next
        .filter(
          (provider) =>
            provider.routeKind !== "unavailable" &&
            (provider.runtimeKind === "claude" ||
              provider.runtimeKind === "codex"),
        )
        .flatMap((provider) =>
          provider.models.map((model) => ({ provider, model })),
        )[0];
      if (first) {
        setRoute(`${first.provider.runtimeKind}:${first.model.id}`);
        setEffort(defaultEffort(first.model.efforts));
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
    setResult(null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !instructions.trim() || analyzing) return;
    setAnalyzing(true);
    setResult(null);
    setError(null);
    try {
      setResult(
        await onAnalyze({
          threadId,
          runtimeKind: selected.runtimeKind,
          model: selected.model.id,
          action,
          instructions: instructions.trim(),
          ...(effort ? { effort } : {}),
        }),
      );
    } catch {
      setError(
        "Não foi possível concluir a ação. Sua mensagem não foi alterada.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <Modal.Root state={state}>
      <Modal.Trigger className="inbox-ai-actions-trigger">
        <Sparkles aria-hidden="true" size={14} />
        Ações com IA
      </Modal.Trigger>
      <Modal.Backdrop className="inbox-modal-backdrop">
        <Modal.Container className="inbox-ai-actions-modal" placement="center">
          <Modal.Dialog>
            <form onSubmit={submit}>
              <Modal.Header className="inbox-ai-actions-modal__header">
                <span className="inbox-ai-actions-modal__mark">
                  <Sparkles aria-hidden="true" size={16} />
                </span>
                <div>
                  <Modal.Heading>Ações com IA</Modal.Heading>
                  <p>Analise a conversa sem responder ou alterar o email.</p>
                </div>
                <Button
                  aria-label="Fechar ações com IA"
                  className="inbox-modal-close"
                  isIconOnly
                  onPress={state.close}
                  size="sm"
                  variant="ghost"
                >
                  <X aria-hidden="true" size={15} />
                </Button>
              </Modal.Header>
              <Modal.Body className="inbox-ai-actions-modal__body">
                <div
                  className="inbox-ai-actions-modal__presets"
                  role="group"
                  aria-label="Ações rápidas"
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
                        <Icon aria-hidden="true" size={14} />
                        {preset.label}
                      </button>
                    );
                  })}
                  <button
                    data-selected={action === "custom" || undefined}
                    onClick={() => {
                      setAction("custom");
                      setInstructions("");
                      setResult(null);
                    }}
                    type="button"
                  >
                    <Sparkles aria-hidden="true" size={14} /> Personalizada
                  </button>
                </div>
                <label className="inbox-ai-actions-modal__prompt">
                  <span>O que você quer saber?</span>
                  <textarea
                    aria-label="O que você quer saber?"
                    maxLength={4_000}
                    onChange={(event) => {
                      setInstructions(event.target.value);
                      setError(null);
                    }}
                    placeholder="Ex.: identifique riscos e sugira os próximos passos."
                    value={instructions}
                  />
                </label>
                <div className="inbox-ai-actions-modal__runtime">
                  <label>
                    <span>Modelo</span>
                    <div>
                      <select
                        aria-label="Modelo para ação de IA"
                        disabled={loadingCatalog}
                        onChange={(event) => {
                          const next = routes.find(
                            (candidate) =>
                              candidate.value === event.target.value,
                          );
                          setRoute(event.target.value);
                          setEffort(defaultEffort(next?.model.efforts));
                        }}
                        value={route}
                      >
                        <option value="">Selecione um modelo</option>
                        {routes.map((candidate) => (
                          <option key={candidate.value} value={candidate.value}>
                            {candidate.providerLabel} · {candidate.model.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown aria-hidden="true" size={14} />
                    </div>
                  </label>
                  {efforts.length > 0 && (
                    <label>
                      <span>Effort</span>
                      <div>
                        <select
                          aria-label="Effort para ação de IA"
                          onChange={(event) => setEffort(event.target.value)}
                          value={effort}
                        >
                          {efforts.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </select>
                        <ChevronDown aria-hidden="true" size={14} />
                      </div>
                    </label>
                  )}
                </div>
                {result && (
                  <section
                    className="inbox-ai-actions-modal__result"
                    aria-live="polite"
                  >
                    <header>
                      <div>
                        <Check aria-hidden="true" size={14} /> Análise concluída
                      </div>
                      <button
                        onClick={() => {
                          void copyText(result.content).then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1_500);
                          });
                        }}
                        type="button"
                      >
                        <Clipboard aria-hidden="true" size={13} />
                        {copied ? "Copiado" : "Copiar"}
                      </button>
                    </header>
                    <pre>{result.content}</pre>
                  </section>
                )}
                {error && (
                  <p className="inbox-ai-actions-modal__error" role="alert">
                    {error}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer className="inbox-ai-actions-modal__footer">
                <Button onPress={state.close} variant="ghost">
                  Fechar
                </Button>
                <Button
                  className="inbox-ai-actions-modal__submit"
                  isDisabled={!selected || !instructions.trim() || analyzing}
                  type="submit"
                >
                  {analyzing ? (
                    <Spinner size="sm" />
                  ) : (
                    <Sparkles aria-hidden="true" size={14} />
                  )}
                  {analyzing ? "Analisando…" : "Executar ação"}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

function defaultEffort(efforts: string[] | undefined): string {
  if (!efforts?.length) return "";
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
