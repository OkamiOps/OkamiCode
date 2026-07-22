import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Plug,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

type ConnectionView = "mcp" | "skills";

function sourceFamily(source: string): string {
  if (source.startsWith("projeto")) return "Projeto atual";
  if (source.startsWith("plugin")) return "Plugins";
  if (source.startsWith("pessoal")) return "Pessoal";
  return "Outros";
}

export function ConnectionsPage() {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const workspacePath =
    (tasks.data ?? []).find((task) => task.id === selectedTaskId)
      ?.workspacePath ?? undefined;
  const servers = useQuery({
    queryKey: ["eco", "mcp", workspacePath],
    queryFn: () =>
      workbenchClient.ecoMcp(workspacePath ? { workspacePath } : {}),
  });
  const skills = useQuery({
    queryKey: ["eco", "skills", workspacePath],
    queryFn: () =>
      workbenchClient.ecoSkills(workspacePath ? { workspacePath } : {}),
  });
  const [view, setView] = useState<ConnectionView>("mcp");
  const [filter, setFilter] = useState("");
  const [origin, setOrigin] = useState("Todas as origens");
  const [runtime, setRuntime] = useState("Todos os runtimes");

  const origins = useMemo(
    () => [
      "Todas as origens",
      ...new Set(
        (skills.data ?? []).map((skill) => sourceFamily(skill.source)),
      ),
    ],
    [skills.data],
  );
  const term = filter.trim().toLowerCase();
  const visibleServers = (servers.data ?? []).filter(
    (server) =>
      (term === "" ||
        server.name.toLowerCase().includes(term) ||
        server.detail.toLowerCase().includes(term)) &&
      (runtime === "Todos os runtimes" || server.runtime === runtime),
  );
  const visibleSkills = (skills.data ?? []).filter(
    (skill) =>
      (term === "" ||
        skill.name.toLowerCase().includes(term) ||
        skill.description.toLowerCase().includes(term) ||
        skill.category.toLowerCase().includes(term)) &&
      (origin === "Todas as origens" ||
        sourceFamily(skill.source) === origin) &&
      (runtime === "Todos os runtimes" ||
        skill.runtimes.includes(runtime as "claude" | "codex")),
  );
  const skillsByCategory = Object.entries(
    visibleSkills.reduce<Record<string, IpcResponse<"eco:skills">[number][]>>(
      (groups, skill) => {
        (groups[skill.category] ??= []).push(skill);
        return groups;
      },
      {},
    ),
  ).sort(([left], [right]) => left.localeCompare(right, "pt-BR"));

  return (
    <section aria-label="Conexões" className="control-page">
      <header className="control-page__header">
        <div>
          <span className="control-page__kicker">Ecossistema local</span>
          <h1>Conexões</h1>
          <p>
            Veja o que cada runtime consegue carregar, de onde veio e qual
            workspace influencia o resultado.
          </p>
        </div>
        <div className="connection-scope">
          <span>Escopo em leitura</span>
          <strong>{workspacePath ?? "Somente configurações pessoais"}</strong>
        </div>
      </header>

      <div className="connection-summary" aria-label="Resumo das conexões">
        <div>
          <Plug aria-hidden="true" size={17} />
          <span>
            <strong>{servers.data?.length ?? 0}</strong> servidores MCP
            <small>ferramentas expostas aos runtimes</small>
          </span>
        </div>
        <div>
          <Sparkles aria-hidden="true" size={17} />
          <span>
            <strong>{skills.data?.length ?? 0}</strong> habilidades
            <small>prompts e fluxos reutilizáveis</small>
          </span>
        </div>
        <div>
          <CircleAlert aria-hidden="true" size={17} />
          <span>
            <strong>Versão não exposta</strong>
            <small>nenhuma atualização será inventada</small>
          </span>
        </div>
      </div>

      <div
        className="connection-tabs"
        role="tablist"
        aria-label="Tipo de conexão"
      >
        <button
          aria-selected={view === "mcp"}
          onClick={() => setView("mcp")}
          role="tab"
          type="button"
        >
          <Plug aria-hidden="true" size={15} /> MCP{" "}
          <span>{servers.data?.length ?? 0}</span>
        </button>
        <button
          aria-selected={view === "skills"}
          onClick={() => setView("skills")}
          role="tab"
          type="button"
        >
          <Sparkles aria-hidden="true" size={15} /> Habilidades{" "}
          <span>{skills.data?.length ?? 0}</span>
        </button>
      </div>

      <div className="control-toolbar control-toolbar--filters">
        <label className="control-search">
          <Search aria-hidden="true" size={15} />
          <span className="sr-only">Buscar conexões</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={
              view === "mcp"
                ? "Buscar servidor ou endereço…"
                : "Buscar habilidade, categoria ou descrição…"
            }
          />
        </label>
        {view === "skills" && (
          <label className="control-select">
            <span>Origem</span>
            <select
              aria-label="Filtrar origem"
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            >
              {origins.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </select>
          </label>
        )}
        <label className="control-select">
          <span>Runtime</span>
          <select
            aria-label="Filtrar runtime"
            value={runtime}
            onChange={(event) => setRuntime(event.target.value)}
          >
            <option>Todos os runtimes</option>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </label>
      </div>

      {view === "mcp" ? (
        <section className="control-section connection-panel" role="tabpanel">
          <header>
            <div>
              <h2>Servidores MCP</h2>
              <p>Conexões efetivamente encontradas nos arquivos locais.</p>
            </div>
            <span>{visibleServers.length}</span>
          </header>
          {servers.isLoading ? (
            <div className="control-skeleton" aria-label="Lendo servidores" />
          ) : visibleServers.length === 0 ? (
            <div className="control-empty">
              <Plug aria-hidden="true" size={20} />
              <strong>Nenhum servidor neste filtro</strong>
              <p>
                Ajuste a busca ou configure o MCP no Claude/Codex para este
                escopo.
              </p>
            </div>
          ) : (
            <ul className="connection-list">
              {visibleServers.map((server) => {
                const configured = server.detail.trim().length > 0;
                return (
                  <li key={`${server.runtime}-${server.scope}-${server.name}`}>
                    <div
                      className={`connection-list__mark connection-list__mark--${server.runtime}`}
                    >
                      <Boxes aria-hidden="true" size={15} />
                    </div>
                    <div className="connection-list__body">
                      <strong>{server.name}</strong>
                      <code>{server.detail || "Comando não declarado"}</code>
                      <div>
                        <span>{server.runtime}</span>
                        <span>{server.transport}</span>
                        <span>{server.scope}</span>
                      </div>
                    </div>
                    <span
                      className={`connection-status connection-status--${configured ? "ready" : "attention"}`}
                    >
                      {configured ? (
                        <CheckCircle2 aria-hidden="true" size={13} />
                      ) : (
                        <CircleAlert aria-hidden="true" size={13} />
                      )}
                      {configured ? "Configurado" : "Revisar"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section className="connection-categories" role="tabpanel">
          <div className="connection-version-note">
            <CircleAlert aria-hidden="true" size={16} />
            <div>
              <strong>Atualizações não são verificáveis nesta fonte</strong>
              <p>
                Os arquivos SKILL.md atuais não expõem uma versão remota
                comparável. O Okami mostra origem e runtime, mas não afirma que
                algo está atualizado sem evidência.
              </p>
            </div>
          </div>
          {skills.isLoading ? (
            <div className="control-skeleton" aria-label="Lendo habilidades" />
          ) : skillsByCategory.length === 0 ? (
            <div className="control-empty">
              <Sparkles aria-hidden="true" size={20} />
              <strong>Nenhuma habilidade neste filtro</strong>
              <p>Altere origem, runtime ou termo de busca.</p>
            </div>
          ) : (
            skillsByCategory.map(([category, entries]) => (
              <details
                className="connection-category"
                key={category}
                open={term !== "" || skillsByCategory.length <= 5}
              >
                <summary>
                  <span>
                    <ChevronDown aria-hidden="true" size={15} />
                    <strong>{category}</strong>
                    <small>{entries?.length ?? 0} habilidades</small>
                  </span>
                  <div>
                    {[
                      ...new Set(
                        entries?.flatMap((entry) => entry.runtimes) ?? [],
                      ),
                    ].map((entry) => (
                      <em key={entry}>{entry}</em>
                    ))}
                  </div>
                </summary>
                <ul>
                  {(entries ?? []).map((skill) => (
                    <li key={`${skill.invocation}-${skill.source}`}>
                      <div>
                        <strong>{skill.name}</strong>
                        <p>
                          {skill.description ||
                            "Sem descrição no arquivo da habilidade."}
                        </p>
                      </div>
                      <div className="connection-skill__meta">
                        <code>/{skill.invocation}</code>
                        <span>{skill.source}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </section>
      )}
    </section>
  );
}
