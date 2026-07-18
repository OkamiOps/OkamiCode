import { Button, ListBox, Skeleton, Tooltip } from "@heroui/react";
import { CircleDot, ListCollapse } from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge";
import type { WorkbenchTask } from "./api";

interface TaskListPaneProps {
  error: Error | null;
  isLoading: boolean;
  onCollapse: () => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
  tasks: WorkbenchTask[];
}

export function TaskListPane({
  error,
  isLoading,
  onCollapse,
  onSelect,
  selectedTaskId,
  tasks,
}: TaskListPaneProps) {
  const activeCount = tasks.filter((task) => task.status === "active").length;

  return (
    <section
      aria-label="Lista de tarefas"
      className="queue-pane h-full min-h-0"
    >
      <header className="pane-header queue-pane__header">
        <div>
          <p className="pane-kicker">Fila</p>
          <h2>Tarefas</h2>
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
      <div className="queue-pane__summary">
        <span>Todas</span>
        <StatusBadge
          label={`${activeCount} ${activeCount === 1 ? "ativa" : "ativas"}`}
          status={activeCount > 0 ? "online" : "neutral"}
        />
      </div>
      {isLoading ? (
        <div className="grid gap-2 p-3" aria-label="Carregando tarefas">
          <Skeleton className="h-16 rounded-[var(--ok-radius-md)]" />
          <Skeleton className="h-16 rounded-[var(--ok-radius-md)]" />
          <Skeleton className="h-16 rounded-[var(--ok-radius-md)]" />
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
          className="min-h-0 flex-1 overflow-y-auto p-2"
          onAction={(key) => onSelect(String(key))}
          selectedKeys={selectedTaskId ? new Set([selectedTaskId]) : new Set()}
          selectionMode="single"
        >
          {tasks.map((task) => (
            <ListBox.Item
              className="mb-1 grid min-h-16 grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-[var(--ok-radius-md)] border border-transparent px-2 py-2 text-[var(--ok-text-muted)] data-[selected=true]:border-[var(--ok-border)] data-[selected=true]:bg-[var(--ok-surface-3)] data-[selected=true]:text-[var(--ok-text)]"
              id={task.id}
              key={task.id}
              textValue={task.title}
            >
              <CircleDot
                aria-hidden="true"
                className="mt-0.5 text-[var(--ok-orange)]"
                size={15}
              />
              <span className="min-w-0">
                <strong className="block truncate text-xs font-semibold text-[var(--ok-text)]">
                  {task.title}
                </strong>
                <span className="mt-1 block truncate text-[11px]">
                  {task.objective}
                </span>
              </span>
            </ListBox.Item>
          ))}
        </ListBox>
      )}
    </section>
  );
}
