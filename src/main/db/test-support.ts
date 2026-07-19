import SqliteDatabase from "better-sqlite3-multiple-ciphers";
import { randomUUID } from "node:crypto";
import {
  canonicalEventSchema,
  type CanonicalEvent,
} from "../../shared/contracts/event";
import type { Database } from "./connection";
import { runMigrations } from "./migrations";
import { AuditRepository } from "./repositories/audit";
import { EventRepository } from "./repositories/events";
import { LaneRepository } from "./repositories/lanes";
import { RunRepository } from "./repositories/runs";
import { TaskRepository } from "./repositories/tasks";

export function sequenceEvent(
  sequence: number,
  nativeEventId: string,
): Partial<CanonicalEvent> {
  return { sequence, nativeEventId };
}

export interface TestDatabase {
  db: Database;
  tasks: TaskRepository;
  lanes: LaneRepository;
  runs: RunRepository;
  events: EventRepository;
  audit: AuditRepository;
  taskId: string;
  laneId: string;
  runId: string;
  event(overrides?: Partial<CanonicalEvent>): CanonicalEvent;
}

export function createTestDatabase(): TestDatabase {
  const db = new SqliteDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const tasks = new TaskRepository(db);
  const lanes = new LaneRepository(db);
  const runs = new RunRepository(db);
  const events = new EventRepository(db);
  const audit = new AuditRepository(db);
  const taskId = randomUUID();
  const laneId = randomUUID();
  const runId = randomUUID();
  const now = new Date().toISOString();

  tasks.insert({
    id: taskId,
    kind: "workbench",
    title: "Test task",
    objective: "Exercise repositories",
    status: "active",
    workspacePath: null,
    createdAt: now,
    updatedAt: now,
  });
  lanes.insert({
    id: laneId,
    taskId,
    runtimeKind: "claude",
    providerKind: "claude_max",
    model: "claude-test",
    status: "ready",
    workspacePath: null,
    lastEventCursor: 0,
    createdAt: now,
    updatedAt: now,
  });
  runs.insert({
    id: runId,
    taskId,
    laneId,
    status: "running",
    startedAt: now,
    finishedAt: null,
    error: null,
  });

  return {
    db,
    tasks,
    lanes,
    runs,
    events,
    audit,
    taskId,
    laneId,
    runId,
    event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
      return canonicalEventSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        taskId,
        laneId,
        runId,
        sequence: 1,
        occurredAt: new Date().toISOString(),
        kind: "message_delta",
        nativeEventId: null,
        payload: {},
        ...overrides,
      });
    },
  };
}
