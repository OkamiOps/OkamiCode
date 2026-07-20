import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Save } from "lucide-react";
import { useState } from "react";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

// The memory the runtimes actually read: CLAUDE.md and AGENTS.md, editable
// here so the instructions and the app stay in one place.
export function MemoryPage() {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const workspacePath =
    (tasks.data ?? []).find((task) => task.id === selectedTaskId)
      ?.workspacePath ?? undefined;

  const files = useQuery({
    queryKey: ["eco", "memory", workspacePath],
    queryFn: () =>
      workbenchClient.ecoMemoryList(workspacePath ? { workspacePath } : {}),
  });
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const content = useQuery({
    queryKey: ["eco", "memory-file", openPath],
    queryFn: () => workbenchClient.ecoMemoryRead({ path: openPath! }),
    enabled: openPath !== null,
  });
  const save = useMutation({
    mutationFn: (value: string) =>
      workbenchClient.ecoMemoryWrite({ path: openPath!, content: value }),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["eco", "memory-file"] });
      void queryClient.invalidateQueries({ queryKey: ["eco", "memory"] });
    },
  });

  const current = draft ?? content.data?.content ?? "";

  return (
    <section aria-label="Memória" className="eco-page">
      <header className="eco-page__header">
        <h1>Memória</h1>
        <p>
          Instruções que os runtimes leem a cada sessão. Editar aqui altera o
          arquivo real no disco.
        </p>
      </header>

      <div className="eco-memory">
        <aside className="eco-memory__list">
          {files.data?.length === 0 && (
            <p className="eco-empty">
              Nenhum arquivo de memória encontrado. Crie um{" "}
              <code>CLAUDE.md</code> na pasta da conversa.
            </p>
          )}
          {(files.data ?? []).map((file) => (
            <button
              className="eco-memory__item"
              data-active={openPath === file.path || undefined}
              key={file.path}
              onClick={() => {
                setOpenPath(file.path);
                setDraft(null);
              }}
              type="button"
            >
              <FileText aria-hidden="true" size={13} />
              <span>
                {file.label}
                <small>{(file.bytes / 1024).toFixed(1)} KB</small>
              </span>
            </button>
          ))}
        </aside>

        <div className="eco-memory__editor">
          {!openPath && (
            <p className="eco-empty">Escolha um arquivo para ver e editar.</p>
          )}
          {openPath && (
            <>
              <div className="eco-memory__bar">
                <code>{openPath}</code>
                <button
                  disabled={draft === null || save.isPending}
                  onClick={() => save.mutate(current)}
                  type="button"
                >
                  <Save aria-hidden="true" size={12} />
                  {save.isPending ? "Salvando…" : "Salvar"}
                </button>
              </div>
              <textarea
                aria-label="Conteúdo da memória"
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                value={current}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
