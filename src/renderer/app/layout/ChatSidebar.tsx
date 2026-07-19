import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Link2, Plug, Plus } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../../features/workbench/store";

export function ChatSidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const selectTask = useWorkbenchStore((state) => state.selectTask);

  const tasksQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => workbenchClient.taskList(),
  });
  const createTask = useMutation({
    mutationFn: () =>
      workbenchClient.taskCreate({
        title: "Nova conversa",
        objective: "Conversa iniciada no Okami Workbench",
      }),
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      selectTask(task.id);
      navigate("/workbench");
    },
  });

  const tasks = tasksQuery.data ?? [];

  return (
    <aside aria-label="Conversas" className="chat-sidebar">
      <div className="chat-sidebar__brand">
        <span aria-hidden="true" className="chat-sidebar__brand-mark">
          <svg
            fill="none"
            height="15"
            stroke="currentColor"
            strokeWidth="2.4"
            viewBox="0 0 24 24"
            width="15"
          >
            <path d="M4 4l4 5 4-3 4 3 4-5v9a8 8 0 0 1-16 0z" />
          </svg>
        </span>
        Okami
      </div>

      <button
        className="chat-new-button"
        disabled={createTask.isPending}
        onClick={() => createTask.mutate()}
        type="button"
      >
        <Plus aria-hidden="true" size={15} />
        Nova conversa
      </button>

      <nav aria-label="Histórico de conversas" className="chat-sessions">
        <div className="chat-sessions__label">Conversas</div>
        {tasks.length === 0 && !tasksQuery.isLoading && (
          <p className="chat-sessions__empty">
            Nenhuma conversa ainda. Comece uma nova.
          </p>
        )}
        {tasks.map((task) => (
          <button
            className="chat-session"
            data-active={task.id === selectedTaskId || undefined}
            key={task.id}
            onClick={() => {
              selectTask(task.id);
              navigate("/workbench");
            }}
            type="button"
          >
            {task.title}
          </button>
        ))}
      </nav>

      <footer className="chat-sidebar__footer">
        <NavLink className="chat-footer-link" to="/usage">
          <Gauge aria-hidden="true" size={15} />
          Uso e limites
        </NavLink>
        <NavLink className="chat-footer-link" to="/connections">
          <Plug aria-hidden="true" size={15} />
          Conexões
        </NavLink>
        <NavLink className="chat-footer-link" to="/memory">
          <Link2 aria-hidden="true" size={15} />
          Memória
        </NavLink>
      </footer>
    </aside>
  );
}
