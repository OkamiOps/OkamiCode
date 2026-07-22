import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpenText,
  BrainCircuit,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

const GBRAIN_INSTALL_URL =
  "https://github.com/garrytan/gbrain/blob/master/docs/INSTALL.md";

export function MemoryPage() {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const queryClient = useQueryClient();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const workspacePath = (tasks.data ?? []).find(
    (task) => task.id === selectedTaskId,
  )?.workspacePath;
  const files = useQuery({
    queryKey: ["eco", "memory", workspacePath],
    queryFn: () =>
      workbenchClient.ecoMemoryList(workspacePath ? { workspacePath } : {}),
  });
  const sources = useQuery({
    queryKey: ["memory", "sources"],
    queryFn: () => workbenchClient.memoryList(),
  });
  const status = useQuery({
    queryKey: ["memory", "status"],
    queryFn: () => workbenchClient.memoryStatus(),
  });
  const results = useQuery({
    queryKey: ["memory", "search", searchQuery],
    queryFn: () =>
      workbenchClient.memorySearch({ query: searchQuery, limit: 30 }),
    enabled: searchQuery.length > 0,
  });
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
  const configure = useMutation({
    mutationFn: async () => {
      const selected = await workbenchClient.workspacePick({
        purpose: "memory",
      });
      if (!selected.path) return [];
      return workbenchClient.memoryConfigure({ paths: [selected.path] });
    },
    onSuccess: (configured) => {
      if (configured.length === 0) return;
      void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });
  const reindex = useMutation({
    mutationFn: (sourceId: string) =>
      workbenchClient.memoryReindex({ sourceId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["memory"] });
    },
  });

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = searchInput.trim();
    if (value) setSearchQuery(value);
  }

  const current = draft ?? content.data?.content ?? "";
  const memoryStatus = status.data;

  return (
    <section aria-label="Memória" className="memory-hub">
      <header className="memory-hub__header">
        <div>
          <span className="memory-hub__kicker">Conhecimento local</span>
          <h1>Central de memória</h1>
          <p>
            Pesquise o índice FTS5, acompanhe as pastas do Obsidian e saiba
            exatamente quando o grafo relacional está disponível.
          </p>
        </div>
        <button
          className="memory-button memory-button--primary"
          disabled={configure.isPending}
          onClick={() => configure.mutate()}
          type="button"
        >
          <FolderOpen aria-hidden="true" size={16} />
          {configure.isPending ? "Escolhendo…" : "Adicionar pasta"}
        </button>
      </header>

      <div className="memory-engine-strip" aria-label="Motores de memória">
        <EngineStatus
          icon={Database}
          label="SQLite FTS5"
          state={memoryStatus?.fts5.available ? "Ativo" : "Indisponível"}
          detail={`${memoryStatus?.fts5.documents ?? 0} documentos indexados`}
          tone={memoryStatus?.fts5.available ? "cyan" : "muted"}
        />
        <EngineStatus
          icon={BookOpenText}
          label="Obsidian"
          state={
            memoryStatus?.obsidian.configured ? "Sincronizado" : "Configurar"
          }
          detail={`${memoryStatus?.obsidian.sources ?? 0} pastas monitoradas`}
          tone={memoryStatus?.obsidian.configured ? "violet" : "muted"}
        />
        <EngineStatus
          icon={BrainCircuit}
          label="GBrain"
          state={memoryStatus?.gbrain.installed ? "Instalado" : "Não instalado"}
          detail={memoryStatus?.gbrain.version ?? "Grafo relacional opcional"}
          tone={memoryStatus?.gbrain.installed ? "orange" : "muted"}
          action={
            !memoryStatus?.gbrain.installed
              ? () =>
                  void workbenchClient.systemOpenExternal({
                    url: GBRAIN_INSTALL_URL,
                  })
              : undefined
          }
        />
      </div>

      {configure.error && (
        <div className="memory-alert" role="alert">
          Não foi possível indexar a pasta. Confirme se ela ainda existe e não é
          um atalho simbólico.
        </div>
      )}

      <div className="memory-hub__workspace">
        <aside className="memory-sources" aria-label="Fontes de memória">
          <div className="memory-section-heading">
            <div>
              <span>Fontes autorizadas</span>
              <strong>{sources.data?.length ?? 0}</strong>
            </div>
            <small>Somente leitura para agentes</small>
          </div>
          <div className="memory-source-list">
            {(sources.data ?? []).map((source) => (
              <article className="memory-source" key={source.id}>
                <BookOpenText aria-hidden="true" size={16} />
                <div>
                  <strong>{source.scopePath.split("/").at(-1)}</strong>
                  <span title={source.scopePath}>{source.scopePath}</span>
                </div>
                <button
                  aria-label={`Reindexar ${source.scopePath}`}
                  disabled={reindex.isPending}
                  onClick={() => reindex.mutate(source.id)}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={14} />
                </button>
              </article>
            ))}
            {sources.data?.length === 0 && (
              <div className="memory-empty memory-empty--compact">
                <FolderOpen aria-hidden="true" size={20} />
                <strong>Nenhuma pasta indexada</strong>
                <span>Adicione seu vault ou uma pasta específica.</span>
              </div>
            )}
          </div>

          <div className="memory-instruction-files">
            <div className="memory-section-heading">
              <div>
                <span>Instruções dos runtimes</span>
                <strong>{files.data?.length ?? 0}</strong>
              </div>
              <small>Arquivos reais no disco</small>
            </div>
            {(files.data ?? []).map((file) => (
              <button
                className="memory-file"
                data-active={openPath === file.path || undefined}
                key={file.path}
                onClick={() => {
                  setOpenPath(file.path);
                  setDraft(null);
                }}
                type="button"
              >
                <FileText aria-hidden="true" size={15} />
                <span>
                  <strong>{file.label}</strong>
                  <small>{(file.bytes / 1024).toFixed(1)} KB</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="memory-canvas">
          <form className="memory-search" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Pesquisar memória"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Pesquisar decisões, projetos, pessoas ou reuniões…"
              type="search"
              value={searchInput}
            />
            <button
              disabled={!searchInput.trim() || results.isFetching}
              type="submit"
            >
              {results.isFetching ? "Buscando…" : "Buscar"}
            </button>
          </form>

          {openPath ? (
            <section
              className="memory-editor"
              aria-label="Editor de instruções"
            >
              <header>
                <div>
                  <span>Arquivo de instrução</span>
                  <code title={openPath}>{openPath}</code>
                </div>
                <button
                  disabled={draft === null || save.isPending}
                  onClick={() => save.mutate(current)}
                  type="button"
                >
                  <Save aria-hidden="true" size={14} />
                  {save.isPending ? "Salvando…" : "Salvar alterações"}
                </button>
              </header>
              <textarea
                aria-label="Conteúdo da memória"
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                value={current}
              />
            </section>
          ) : searchQuery ? (
            <section className="memory-results" aria-live="polite">
              <header>
                <div>
                  <span>Resultados no índice local</span>
                  <h2>“{searchQuery}”</h2>
                </div>
                <strong>{results.data?.length ?? 0} encontrados</strong>
              </header>
              {(results.data ?? []).map((result) => (
                <article className="memory-result" key={result.id}>
                  <Database aria-hidden="true" size={15} />
                  <div>
                    <h3>{result.title}</h3>
                    <p>{result.excerpt}</p>
                    <code>{result.citation}</code>
                  </div>
                </article>
              ))}
              {results.data?.length === 0 && !results.isFetching && (
                <div className="memory-empty">
                  <Search aria-hidden="true" size={24} />
                  <strong>Nada encontrado</strong>
                  <span>
                    Tente termos mais específicos ou reindexe a fonte.
                  </span>
                </div>
              )}
            </section>
          ) : (
            <div className="memory-empty memory-empty--hero">
              <BrainCircuit aria-hidden="true" size={30} />
              <span>Recuperação local e rastreável</span>
              <strong>Encontre o contexto sem reenviar seu histórico</strong>
              <p>
                O FTS5 pesquisa localmente. O Obsidian continua sendo a fonte
                portátil. O GBrain só aparece como ativo quando o CLI existe.
              </p>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function EngineStatus({
  icon: Icon,
  label,
  state,
  detail,
  tone,
  action,
}: {
  icon: typeof Database;
  label: string;
  state: string;
  detail: string;
  tone: "cyan" | "violet" | "orange" | "muted";
  action?: () => void;
}) {
  return (
    <article className="memory-engine" data-tone={tone}>
      <span className="memory-engine__icon">
        <Icon aria-hidden="true" size={18} />
      </span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      {action ? (
        <button onClick={action} type="button">
          {state}
          <ExternalLink aria-hidden="true" size={12} />
        </button>
      ) : (
        <span className="memory-engine__state">{state}</span>
      )}
    </article>
  );
}
