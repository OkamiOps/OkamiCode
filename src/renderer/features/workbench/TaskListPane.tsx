import { Button, ListBox, Skeleton, Tooltip } from "@heroui/react";
import { ListCollapse } from "lucide-react";
import type { WorkbenchLane, WorkbenchTask } from "./api";

interface TaskListPaneProps {
  error: Error | null;
  isLoading: boolean;
  onCollapse: () => void;
  onSelect: (taskId: string) => void;
  selectedLane: WorkbenchLane | null;
  selectedTaskId: string | null;
  tasks: WorkbenchTask[];
}

export function TaskListPane({
  error,
  isLoading,
  onCollapse,
  onSelect,
  selectedLane,
  selectedTaskId,
  tasks,
}: TaskListPaneProps) {
  const activeCount = tasks.filter((task) => task.status === "active").length;

  return (
    <section
      aria-label="Lista de tarefas"
      className="queue-pane task-list-pane"
    >
      <header className="task-list-header">
        <div>
          <h2>Abertas</h2>
          <span>
            {activeCount} {activeCount === 1 ? "tarefa" : "tarefas"}
          </span>
        </div>
        <Tooltip.Root closeDelay={0} delay={300}>
          <Button
            aria-label="Recolher lista de tarefas"
            className="icon-button"
            isIconOnly
            variant="ghost"
            onPress={onCollapse}
          >
            <ListCollapse aria-hidden="true" size={17} />
          </Button>
          <Tooltip.Content className="ok-tooltip" placement="right">
            Recolher lista de tarefas
          </Tooltip.Content>
        </Tooltip.Root>
      </header>
      {isLoading ? (
        <div className="grid gap-2 p-3" aria-label="Carregando tarefas">
          <Skeleton className="h-20 rounded-[var(--ok-radius-md)]" />
          <Skeleton className="h-20 rounded-[var(--ok-radius-md)]" />
          <Skeleton className="h-20 rounded-[var(--ok-radius-md)]" />
        </div>
      ) : error ? (
        <div className="queue-pane__empty" role="alert">
          <span aria-hidden="true">!</span>
          <p>Não foi possível carregar as tarefas.</p>
          <small>{error.message}</small>
        </div>
      ) : tasks.length === 0 ? (
        <div className="queue-pane__empty">
          <span aria-hidden="true">00</span>
          <p>Nenhuma tarefa na fila.</p>
          <small>As tarefas criadas aparecerão aqui.</small>
        </div>
      ) : (
        <ListBox
          aria-label="Tarefas disponíveis"
          className="task-list"
          onAction={(key) => onSelect(String(key))}
          selectedKeys={selectedTaskId ? new Set([selectedTaskId]) : new Set()}
          selectionMode="single"
        >
          {tasks.map((task) => {
            const selected = task.id === selectedTaskId;
            const runtime = runtimePresentation(selected ? selectedLane : null);
            const status = statusPresentation(task.status);
            return (
              <ListBox.Item
                className="task-list-item"
                id={task.id}
                key={task.id}
                textValue={task.title}
              >
                <span
                  aria-hidden="true"
                  className={`task-list-item__glyph runtime-glyph--${runtime.tone}`}
                >
                  {runtime.glyph}
                </span>
                <span className="task-list-item__body">
                  <span className="task-list-item__heading">
                    <strong>{task.title}</strong>
                    <time dateTime={task.updatedAt}>
                      {formatTimestamp(task.updatedAt)}
                    </time>
                  </span>
                  <span className="task-list-item__preview">
                    {task.objective}
                  </span>
                  <span className="task-list-item__badges">
                    <span className={`task-pill task-pill--${status.tone}`}>
                      {status.label}
                    </span>
                    {selectedLane && selected && (
                      <span className="task-pill task-pill--route">
                        {selectedLane.routeKind} ·{" "}
                        {selectedLane.displayQuotaAccount}
                      </span>
                    )}
                  </span>
                </span>
              </ListBox.Item>
            );
          })}
        </ListBox>
      )}
    </section>
  );
}

function runtimePresentation(lane: WorkbenchLane | null) {
  if (!lane) return { glyph: "OB", tone: "task" } as const;
  const account = `${lane.providerAccountLabel} ${lane.model}`.toLowerCase();
  if (account.includes("grok")) return { glyph: "GK", tone: "grok" } as const;
  if (/chatgpt|\bgpt|\bo[134]/u.test(account)) {
    return { glyph: "GP", tone: "gpt" } as const;
  }
  return { glyph: "CL", tone: "claude" } as const;
}

function statusPresentation(status: string) {
  const normalized = status.toLowerCase();
  if (/approval|aprova|waiting|aguard/u.test(normalized)) {
    return { label: "aprovação pendente", tone: "approval" } as const;
  }
  if (/active|running|execut/u.test(normalized)) {
    return { label: "executando", tone: "running" } as const;
  }
  return { label: status.replaceAll("_", " "), tone: "neutral" } as const;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(
    "pt-BR",
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short" },
  ).format(date);
}
