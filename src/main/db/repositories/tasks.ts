import type { Database } from "../connection";

export interface TaskRecord {
  id: string;
  kind: "workbench" | "quick_chat";
  title: string;
  objective: string;
  status: string;
  workspacePath: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskRow {
  id: string;
  workspace_path: string | null;
  kind: TaskRecord["kind"];
  title: string;
  objective: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export class OptimisticConcurrencyError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} has an optimistic concurrency conflict`);
    this.name = "OptimisticConcurrencyError";
  }
}

export class TaskRepository {
  constructor(private readonly db: Database) {}

  insert(task: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO tasks
         (id, kind, title, objective, status, workspace_path, created_at, updated_at)
         VALUES (@id, @kind, @title, @objective, @status, @workspacePath, @createdAt, @updatedAt)`,
      )
      .run(task);
  }

  findById(id: string): TaskRecord | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  update(task: TaskRecord, expectedUpdatedAt: string): void {
    const result = this.db
      .prepare(
        `UPDATE tasks
         SET kind = @kind, title = @title, objective = @objective,
             status = @status, updated_at = @updatedAt
         WHERE id = @id AND updated_at = @expectedUpdatedAt`,
      )
      .run({ ...task, expectedUpdatedAt });
    if (result.changes !== 1) {
      throw new OptimisticConcurrencyError("Task", task.id);
    }
  }
}

function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    objective: row.objective,
    status: row.status,
    workspacePath: row.workspace_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
