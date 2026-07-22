import { useQuery } from "@tanstack/react-query";
import { Plug, Sparkles } from "lucide-react";
import { useState } from "react";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

// Everything on this page comes from the CLIs' own configuration files.
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
    queryKey: ["eco", "skills"],
    queryFn: () => workbenchClient.ecoSkills({}),
  });
  const [filter, setFilter] = useState("");

  const term = filter.trim().toLowerCase();
  const visibleSkills = (skills.data ?? []).filter(
    (skill) =>
      term === "" ||
      skill.name.toLowerCase().includes(term) ||
      skill.description.toLowerCase().includes(term),
  );

  return (
    <section aria-label="Conexões" className="eco-page">
      <header className="eco-page__header">
        <h1>Conexões</h1>
        <p>Servidores MCP e habilidades que os CLIs carregam nesta máquina.</p>
      </header>

      <section className="eco-card">
        <h2>
          <Plug aria-hidden="true" size={15} />
          Servidores MCP
          <span className="eco-count">{servers.data?.length ?? 0}</span>
        </h2>
        {servers.isLoading && <p className="eco-empty">Lendo configuração…</p>}
        {servers.data?.length === 0 && (
          <p className="eco-empty">
            Nenhum servidor MCP configurado para este escopo. Configure com
            <code>claude mcp add</code> ou no <code>~/.codex/config.toml</code>.
          </p>
        )}
        <ul className="eco-list">
          {(servers.data ?? []).map((server) => (
            <li key={`${server.runtime}-${server.scope}-${server.name}`}>
              <span
                aria-hidden="true"
                className={`route-dot route-dot--${server.runtime === "claude" ? "direct" : "bridged"}`}
              />
              <span className="eco-list__main">
                <strong>{server.name}</strong>
                <small>{server.detail || "sem comando declarado"}</small>
              </span>
              <span className="eco-tag">{server.transport}</span>
              <span className="eco-tag eco-tag--muted">{server.scope}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="eco-card">
        <h2>
          <Sparkles aria-hidden="true" size={15} />
          Habilidades
          <span className="eco-count">{skills.data?.length ?? 0}</span>
        </h2>
        <input
          aria-label="Filtrar habilidades"
          className="eco-filter"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrar habilidades…"
          value={filter}
        />
        {skills.data?.length === 0 && (
          <p className="eco-empty">Nenhuma habilidade instalada.</p>
        )}
        <ul className="eco-list">
          {visibleSkills.slice(0, 80).map((skill) => (
            <li key={skill.name}>
              <span className="eco-list__main">
                <strong>{skill.name}</strong>
                <small>{skill.description || "sem descrição"}</small>
              </span>
              <span className="eco-tag eco-tag--muted">{skill.source}</span>
            </li>
          ))}
        </ul>
        {visibleSkills.length > 80 && (
          <p className="eco-empty">
            Mostrando 80 de {visibleSkills.length}. Refine o filtro.
          </p>
        )}
      </section>
    </section>
  );
}
