import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, FolderGit2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

// Every conversation in one place: where it runs, on which models, how much
// it has executed, and the destructive actions kept behind a confirmation.
export function ManagementPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectTask = useWorkbenchStore((state) => state.selectTask);
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const lanes = useQuery({
    queryKey: ["workbench", "lanes", "all"],
    queryFn: () => workbenchClient.laneList({}),
  });
  const runs = useQuery({
    queryKey: ["workbench", "runs", "all"],
    queryFn: () => workbenchClient.runList({}),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["workbench"] });
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
  };
  const archive = useMutation({
    mutationFn: workbenchClient.taskArchive,
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: workbenchClient.taskDelete,
    onSuccess: invalidate,
  });

  const term = filter.trim().toLowerCase();
  const rows = (tasks.data ?? [])
    .filter((task) => (showArchived ? true : task.status !== "archived"))
    .filter(
      (task) =>
        term === "" ||
        task.title.toLowerCase().includes(term) ||
        (task.workspacePath ?? "").toLowerCase().includes(term),
    );

  return (
    <section aria-label="Gestão" className="eco-page">
      <header className="eco-page__header">
        <h1>Gestão</h1>
        <p>Todas as conversas, suas pastas, modelos e execuções.</p>
      </header>

      <section className="eco-card">
        <h2>
          <FolderGit2 aria-hidden="true" size={15} />
          Conversas
          <span className="eco-count">{rows.length}</span>
        </h2>
        <div className="eco-toolbar">
          <input
            aria-label="Filtrar conversas"
            className="eco-filter"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtrar por nome ou pasta…"
            value={filter}
          />
          <label className="eco-check">
            <input
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              type="checkbox"
            />
            Mostrar arquivadas
          </label>
        </div>

        {rows.length === 0 && (
          <p className="eco-empty">Nenhuma conversa com esse filtro.</p>
        )}
        <ul className="eco-list">
          {rows.map((task) => {
            const taskLanes = (lanes.data ?? []).filter(
              (lane) => lane.taskId === task.id,
            );
            const taskRuns = (runs.data ?? []).filter((run) =>
              taskLanes.some((lane) => lane.laneId === run.laneId),
            );
            return (
              <li key={task.id}>
                <button
                  className="eco-list__main eco-list__open"
                  onClick={() => {
                    selectTask(task.id);
                    navigate("/workbench");
                  }}
                  type="button"
                >
                  <strong>
                    {task.title}
                    {task.status === "archived" && (
                      <span className="eco-tag eco-tag--muted">arquivada</span>
                    )}
                  </strong>
                  <small>
                    {task.workspacePath ?? "sem pasta"} ·{" "}
                    {taskLanes.map((lane) => lane.model).join(", ") ||
                      "sem lanes"}{" "}
                    · {taskRuns.length} turnos
                  </small>
                </button>
                <button
                  aria-label={
                    task.status === "archived" ? "Restaurar" : "Arquivar"
                  }
                  className="eco-icon"
                  onClick={() =>
                    archive.mutate({
                      taskId: task.id,
                      archived: task.status !== "archived",
                    })
                  }
                  title={task.status === "archived" ? "Restaurar" : "Arquivar"}
                  type="button"
                >
                  {task.status === "archived" ? (
                    <ArchiveRestore aria-hidden="true" size={13} />
                  ) : (
                    <Archive aria-hidden="true" size={13} />
                  )}
                </button>
                <button
                  aria-label={`Apagar ${task.title}`}
                  className="eco-icon eco-icon--danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Apagar "${task.title}"? O histórico será removido.`,
                      )
                    ) {
                      remove.mutate({ taskId: task.id });
                    }
                  }}
                  title="Apagar"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
