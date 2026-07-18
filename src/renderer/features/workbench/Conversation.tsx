import { Surface } from "@heroui/react";
import { MessageSquareText, Radio } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWorkbenchStore } from "./store";

export function Conversation() {
  const sentMessages = useWorkbenchStore((state) => state.sentMessages);
  const streams = useWorkbenchStore((state) => state.streams);
  const streamedMessages = Object.entries(streams);
  const isEmpty = sentMessages.length === 0 && streamedMessages.length === 0;

  return (
    <div
      aria-label="Conversa da tarefa"
      className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6"
    >
      {isEmpty ? (
        <div className="grid min-h-full place-content-center justify-items-center text-center">
          <span className="grid size-10 place-items-center rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-1)] text-[var(--ok-orange)]">
            <MessageSquareText aria-hidden="true" size={18} />
          </span>
          <h2 className="mt-3 text-sm font-semibold">Conversa pronta</h2>
          <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--ok-text-muted)]">
            Escolha uma lane e envie a próxima instrução. Eventos nativos serão
            anexados aqui em tempo real.
          </p>
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-3xl gap-3" aria-live="polite">
          {sentMessages.map((message) => (
            <Surface
              className="ml-auto max-w-[82%] rounded-[var(--ok-radius-md)] border border-[color-mix(in_srgb,var(--ok-orange)_36%,var(--ok-border))] bg-[color-mix(in_srgb,var(--ok-orange)_12%,var(--ok-surface-2))] px-3 py-2.5 text-sm leading-6 text-[var(--ok-text)]"
              key={message.id}
              variant="secondary"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.body}
              </ReactMarkdown>
            </Surface>
          ))}
          {streamedMessages.map(([key, body]) => (
            <Surface
              className="mr-auto max-w-[88%] rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-1)] px-3 py-2.5 text-sm leading-6 text-[var(--ok-text)] [&_a]:text-[var(--ok-cyan)] [&_code]:text-[var(--ok-cyan)] [&_p]:m-0"
              key={key}
              variant="secondary"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ok-text-muted)]">
                <Radio
                  aria-hidden="true"
                  className="text-[var(--ok-green)]"
                  size={11}
                />
                Streaming
              </div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </Surface>
          ))}
        </div>
      )}
    </div>
  );
}
