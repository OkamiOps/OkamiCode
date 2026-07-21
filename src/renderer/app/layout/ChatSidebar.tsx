import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowUpDown,
  Copy,
  FolderCode,
  FolderSearch,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
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
  const [preferences, setPreferences] = useState(readProjectPreferences);
  const [menu, setMenu] = useState<{
    task: WorkbenchTask;
    x: number;
    y: number;
  } | null>(null);

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
  const archiveTask = useMutation({
    mutationFn: workbenchClient.taskArchive,
    onSuccess: (task) => {
      invalidateTasks();
      if (selectedTaskId === task.id) selectTask(null);
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
  const tasks = useMemo(() => {
    const filtered = (tasksQuery.data ?? []).filter(
      (task) =>
        term === "" ||
        task.title.toLowerCase().includes(term) ||
        (task.workspacePath ?? "").toLowerCase().includes(term),
    );
    return filtered.sort((left, right) => {
      const pinned =
        Number(preferences.pinned.includes(right.id)) -
        Number(preferences.pinned.includes(left.id));
      if (pinned) return pinned;
      if (preferences.sort === "name")
        return left.title.localeCompare(right.title, "pt-BR");
      if (preferences.sort === "workspace")
        return workspaceLabel(left).localeCompare(
          workspaceLabel(right),
          "pt-BR",
        );
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  }, [preferences, tasksQuery.data, term]);
  const sections = useMemo(() => {
    if (!preferences.groupByWorkspace) return [{ label: "Projetos", tasks }];
    const groups = new Map<string, WorkbenchTask[]>();
    for (const task of tasks) {
      const label = workspaceLabel(task);
      groups.set(label, [...(groups.get(label) ?? []), task]);
    }
    return [...groups].map(([label, grouped]) => ({ label, tasks: grouped }));
  }, [preferences.groupByWorkspace, tasks]);

  function updatePreferences(next: ProjectPreferences) {
    setPreferences(next);
    localStorage.setItem(projectPreferencesKey, JSON.stringify(next));
  }

  function openMenu(event: MouseEvent, task: WorkbenchTask) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      task,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 300),
    });
  }

  function startRename(task: WorkbenchTask) {
    setRenamingId(task.id);
    setRenameDraft(task.title);
    setMenu(null);
  }

  function togglePinned(taskId: string) {
    const pinned = preferences.pinned.includes(taskId)
      ? preferences.pinned.filter((id) => id !== taskId)
      : [taskId, ...preferences.pinned];
    updatePreferences({ ...preferences, pinned });
    setMenu(null);
  }

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

      <div className="code-projects-toolbar">
        <span>
          <ArrowUpDown aria-hidden="true" size={12} /> Organizar
        </span>
        <select
          aria-label="Ordenar projetos"
          onChange={(event) =>
            updatePreferences({
              ...preferences,
              sort: event.target.value as ProjectSort,
            })
          }
          value={preferences.sort}
        >
          <option value="recent">Mais recentes</option>
          <option value="name">Nome</option>
          <option value="workspace">Workspace</option>
        </select>
        <button
          aria-pressed={preferences.groupByWorkspace}
          onClick={() =>
            updatePreferences({
              ...preferences,
              groupByWorkspace: !preferences.groupByWorkspace,
            })
          }
          title="Agrupar por workspace"
          type="button"
        >
          <FolderCode aria-hidden="true" size={13} />
        </button>
      </div>

      <nav aria-label="Histórico de projetos" className="chat-sessions">
        {tasks.length === 0 && !tasksQuery.isLoading && (
          <p className="chat-sessions__empty">
            Nenhum projeto ainda. Escolha uma pasta para começar.
          </p>
        )}
        {sections.map((section) => (
          <div className="chat-session-group" key={section.label}>
            <div className="chat-sessions__label">{section.label}</div>
            {section.tasks.map((task) => (
              <div
                className="chat-session"
                data-active={task.id === selectedTaskId || undefined}
                key={task.id}
                onContextMenu={(event) => openMenu(event, task)}
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
                    aria-label={`Opções de ${task.title}`}
                    onClick={(event) => openMenu(event, task)}
                    title="Mais ações"
                    type="button"
                  >
                    <MoreHorizontal aria-hidden="true" size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        ))}
      </nav>
      {menu && (
        <>
          <button
            aria-label="Fechar menu de projeto"
            className="code-project-menu-backdrop"
            onClick={() => setMenu(null)}
            type="button"
          />
          <div
            aria-label={`Ações de ${menu.task.title}`}
            className="code-project-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              onClick={() => togglePinned(menu.task.id)}
              role="menuitem"
              type="button"
            >
              <Pin size={13} />{" "}
              {preferences.pinned.includes(menu.task.id)
                ? "Desafixar projeto"
                : "Fixar projeto"}
            </button>
            <button
              onClick={() => startRename(menu.task)}
              role="menuitem"
              type="button"
            >
              <Pencil size={13} /> Renomear projeto
            </button>
            <button
              disabled={!menu.task.workspacePath}
              onClick={() => {
                if (menu.task.workspacePath)
                  void workbenchClient.systemShowItemInFolder({
                    path: menu.task.workspacePath,
                  });
                setMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <FolderSearch size={13} /> Mostrar no Finder
            </button>
            <button
              disabled={!menu.task.workspacePath}
              onClick={() => {
                if (menu.task.workspacePath)
                  void navigator.clipboard.writeText(menu.task.workspacePath);
                setMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <Copy size={13} /> Copiar diretório
            </button>
            <span className="code-project-menu__separator" />
            <button
              disabled={archiveTask.isPending}
              onClick={() => {
                archiveTask.mutate({ taskId: menu.task.id, archived: true });
                setMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <Archive size={13} /> Arquivar projeto
            </button>
            <button
              className="code-project-menu__danger"
              disabled={deleteTask.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Apagar o projeto "${menu.task.title}"? O histórico dele será removido.`,
                  )
                )
                  deleteTask.mutate({ taskId: menu.task.id });
                setMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <Trash2 size={13} /> Apagar projeto
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

type ProjectSort = "recent" | "name" | "workspace";
interface ProjectPreferences {
  sort: ProjectSort;
  groupByWorkspace: boolean;
  pinned: string[];
}
const projectPreferencesKey = "okami.code.project-preferences";
function readProjectPreferences(): ProjectPreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(projectPreferencesKey) ?? "null",
    ) as Partial<ProjectPreferences> | null;
    return {
      sort: ["recent", "name", "workspace"].includes(value?.sort ?? "")
        ? value!.sort!
        : "recent",
      groupByWorkspace: value?.groupByWorkspace === true,
      pinned: Array.isArray(value?.pinned)
        ? value.pinned.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { sort: "recent", groupByWorkspace: false, pinned: [] };
  }
}
function workspaceLabel(task: WorkbenchTask): string {
  return (
    task.workspacePath?.split("/").filter(Boolean).at(-1) ?? "Sem workspace"
  );
}
