import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderCode, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { workbenchApi, type WorkbenchTask } from "../../features/workbench/api";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../../features/workbench/store";

export function ChatSidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const selectTask = useWorkbenchStore((state) => state.selectTask);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [filter, setFilter] = useState("");

  const tasksQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => workbenchClient.taskList(),
  });
  const invalidateTasks = () => {
    void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["workbench", "tasks"] });
  };
  const createTask = useMutation({
    // Mirrors the Claude/Codex workflow: a conversation is anchored to a
    // folder the user picks before anything runs.
    mutationFn: async () => {
      const picked = await workbenchApi.pickWorkspace();
      if (!picked.path) return null;
      const basename = picked.path.split("/").filter(Boolean).at(-1) ?? "pasta";
      // Repos get the choice of an isolated worktree, like Claude Code.
      const useWorktree = window.confirm(
        `Criar um worktree isolado para este projeto?\n\nOK: o projeto trabalha numa cópia (git worktree) e não mexe no checkout principal.\nCancelar: trabalha direto na pasta ${basename}.`,
      );
      return workbenchApi.createTask({
        title: basename,
        objective: `Projeto na pasta ${picked.path}`,
        workspacePath: picked.path,
        useWorktree,
      });
    },
    onSuccess: (task) => {
      if (!task) return;
      invalidateTasks();
      selectTask(task.id);
      navigate("/workbench");
    },
  });
  const renameTask = useMutation({
    mutationFn: workbenchApi.renameTask,
    onSuccess: () => {
      setRenamingId(null);
      invalidateTasks();
    },
  });
  const deleteTask = useMutation({
    mutationFn: workbenchApi.deleteTask,
    onSuccess: (result) => {
      invalidateTasks();
      if (selectedTaskId === result.taskId) selectTask(null);
    },
  });

  function commitRename(task: WorkbenchTask) {
    const title = renameDraft.trim();
    if (!title || title === task.title) {
      setRenamingId(null);
      return;
    }
    renameTask.mutate({ taskId: task.id, title });
  }

  function handleRenameKeys(
    event: KeyboardEvent<HTMLInputElement>,
    task: WorkbenchTask,
  ) {
    if (event.key === "Enter") commitRename(task);
    if (event.key === "Escape") setRenamingId(null);
  }

  const term = filter.trim().toLowerCase();
  const tasks = (tasksQuery.data ?? []).filter(
    (task) =>
      term === "" ||
      task.title.toLowerCase().includes(term) ||
      (task.workspacePath ?? "").toLowerCase().includes(term),
  );

  return (
    <aside
      aria-label="Projetos do Code"
      className="chat-sidebar code-projects-sidebar"
    >
      <header className="code-projects-sidebar__header">
        <span className="pane-kicker">Desenvolvimento</span>
        <div>
          <span className="code-projects-sidebar__icon" aria-hidden="true">
            <FolderCode size={16} strokeWidth={1.8} />
          </span>
          <h1>Code</h1>
          <span>
            {tasks.length} {tasks.length === 1 ? "projeto" : "projetos"}
          </span>
        </div>
      </header>
      <button
        aria-label="Novo projeto"
        className="chat-new-button"
        disabled={createTask.isPending}
        onClick={() => createTask.mutate()}
        type="button"
      >
        <Plus aria-hidden="true" size={15} />
        Novo projeto
      </button>

      <label className="chat-search">
        <Search aria-hidden="true" size={13} />
        <input
          aria-label="Buscar projetos"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Buscar projetos"
          type="search"
          value={filter}
        />
      </label>

      <nav aria-label="Histórico de projetos" className="chat-sessions">
        <div className="chat-sessions__label">Projetos</div>
        {tasks.length === 0 && !tasksQuery.isLoading && (
          <p className="chat-sessions__empty">
            Nenhum projeto ainda. Escolha uma pasta para começar.
          </p>
        )}
        {tasks.map((task) => (
          <div
            className="chat-session"
            data-active={task.id === selectedTaskId || undefined}
            key={task.id}
          >
            {renamingId === task.id ? (
              <input
                aria-label="Novo nome do projeto"
                className="chat-session__rename"
                ref={(node) => node?.focus()}
                onBlur={() => commitRename(task)}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => handleRenameKeys(event, task)}
                value={renameDraft}
              />
            ) : (
              <button
                className="chat-session__open"
                onClick={() => {
                  selectTask(task.id);
                  navigate("/workbench");
                }}
                type="button"
              >
                <span className="chat-session__title">{task.title}</span>
                {task.workspacePath && (
                  <span className="chat-session__path">
                    {task.workspacePath}
                  </span>
                )}
              </button>
            )}
            <span className="chat-session__actions">
              <button
                aria-label={`Renomear ${task.title}`}
                onClick={() => {
                  setRenamingId(task.id);
                  setRenameDraft(task.title);
                }}
                title="Renomear"
                type="button"
              >
                <Pencil aria-hidden="true" size={12} />
              </button>
              <button
                aria-label={`Apagar ${task.title}`}
                disabled={deleteTask.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Apagar o projeto "${task.title}"? O histórico dele será removido.`,
                    )
                  ) {
                    deleteTask.mutate({ taskId: task.id });
                  }
                }}
                title="Apagar"
                type="button"
              >
                <Trash2 aria-hidden="true" size={12} />
              </button>
            </span>
          </div>
        ))}
      </nav>
    </aside>
  );
}
