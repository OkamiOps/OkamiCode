import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useState } from "react";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

// The subagents the harness can dispatch, read from their own definition
// files (user, plugins and the conversation's own .claude/agents).
export function AgentsPage() {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const workspacePath =
    (tasks.data ?? []).find((task) => task.id === selectedTaskId)
      ?.workspacePath ?? undefined;
  const agents = useQuery({
    queryKey: ["eco", "agents", workspacePath],
    queryFn: () =>
      workbenchClient.ecoAgents(workspacePath ? { workspacePath } : {}),
  });
  const [filter, setFilter] = useState("");

  const term = filter.trim().toLowerCase();
  const visible = (agents.data ?? []).filter(
    (agent) =>
      term === "" ||
      agent.name.toLowerCase().includes(term) ||
      agent.description.toLowerCase().includes(term),
  );

  return (
    <section aria-label="Agentes" className="eco-page">
      <header className="eco-page__header">
        <h1>Agentes</h1>
        <p>
          Subagentes que o harness pode acionar nesta máquina. Cada um vem do
          seu próprio arquivo de definição.
        </p>
      </header>

      <section className="eco-card">
        <h2>
          <Bot aria-hidden="true" size={15} />
          Disponíveis
          <span className="eco-count">{agents.data?.length ?? 0}</span>
        </h2>
        <input
          aria-label="Filtrar agentes"
          className="eco-filter"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrar agentes…"
          value={filter}
        />
        {agents.isLoading && <p className="eco-empty">Lendo definições…</p>}
        {agents.data?.length === 0 && (
          <p className="eco-empty">
            Nenhum agente encontrado. Crie um em{" "}
            <code>.claude/agents/&lt;nome&gt;.md</code> na pasta da conversa.
          </p>
        )}
        <ul className="eco-list">
          {visible.map((agent) => (
            <li key={agent.name}>
              <span className="eco-list__main">
                <strong>{agent.name}</strong>
                <small>{agent.description || "sem descrição"}</small>
              </span>
              {agent.model && <span className="eco-tag">{agent.model}</span>}
              <span className="eco-tag eco-tag--muted">{agent.source}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
