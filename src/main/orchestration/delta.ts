import type { CanonicalEvent } from "../../shared/contracts/event";
import type { Database } from "../db/connection";
import type { EventRepository } from "../db/repositories/events";
import type { LaneRepository } from "../db/repositories/lanes";
import type { TaskRepository } from "../db/repositories/tasks";

export type LaneTemperature = "hot" | "stale" | "cold" | "clean";

export interface DeltaPackage {
  schemaVersion: 1;
  taskId: string;
  fromSequenceExclusive: number;
  toSequenceInclusive: number;
  objective: string;
  constraints: string[];
  decisions: string[];
  git: { branch: string; dirtyFiles: string[] } | null;
  artifacts: string[];
  conversationCursors: Array<{
    sourceLaneId: string;
    toSequenceInclusive: number;
  }>;
  conversation: Array<{
    sequence: number;
    role: "user" | "assistant" | "context";
    body: string;
    laneId: string | null;
    providerLabel?: string;
    model?: string;
    contextKind?: string;
  }>;
  events: Array<{ sequence: number; kind: string; summary: string }>;
}

interface DeltaBuilderDependencies {
  db: Database;
  tasks: Pick<TaskRepository, "findById">;
  lanes: Pick<LaneRepository, "findById">;
  events: Pick<EventRepository, "afterCursor">;
}

interface ArtifactRow {
  uri: string;
}

interface ConversationRow {
  sequence: number;
  role: "user" | "assistant" | "context";
  content_json: string;
}

interface ConversationCursorRow {
  source_lane_id: string;
  last_sequence: number;
}

interface PersistedProjections {
  constraints: string[];
  decisions: string[];
  git: DeltaPackage["git"];
}

export class DeltaBuilder {
  constructor(private readonly dependencies: DeltaBuilderDependencies) {}

  build(laneId: string): DeltaPackage {
    const lane = this.dependencies.lanes.findById(laneId);
    if (!lane) throw new Error(`Unknown lane ${laneId}`);
    const task = this.dependencies.tasks.findById(lane.taskId);
    if (!task) throw new Error(`Unknown task ${lane.taskId}`);

    const allLaneEvents = this.dependencies.events.afterCursor(lane.id, -1);
    const deltaEvents = allLaneEvents.filter(
      (event) => event.sequence > lane.lastEventCursor,
    );
    const projections = projectPersistedState(allLaneEvents);
    const artifacts = this.dependencies.db
      .prepare(
        `SELECT artifacts.uri
         FROM artifacts
         JOIN runs ON runs.id = artifacts.run_id
         WHERE runs.lane_id = ?
         ORDER BY artifacts.created_at ASC, artifacts.id ASC`,
      )
      .all(lane.id) as ArtifactRow[];
    const cursors = new Map(
      (
        this.dependencies.db
          .prepare(
            `SELECT source_lane_id, last_sequence
             FROM event_cursors
             WHERE lane_id = ?`,
          )
          .all(lane.id) as ConversationCursorRow[]
      ).map((row) => [row.source_lane_id, row.last_sequence]),
    );
    const conversation = (
      this.dependencies.db
        .prepare(
          `SELECT messages.sequence, messages.role, messages.content_json
           FROM messages
           JOIN conversations ON conversations.id = messages.conversation_id
           WHERE conversations.task_id = ?
             AND conversations.kind = 'workbench'
             AND messages.role IN ('user', 'assistant', 'context')
           ORDER BY messages.created_at ASC, messages.sequence ASC`,
        )
        .all(task.id) as ConversationRow[]
    ).flatMap((row) => {
      const content = JSON.parse(row.content_json) as Record<string, unknown>;
      if (typeof content.body !== "string" || !content.body.trim()) return [];
      const sourceLaneId =
        typeof content.laneId === "string" ? content.laneId : null;
      if (
        sourceLaneId === lane.id ||
        (sourceLaneId && row.sequence <= (cursors.get(sourceLaneId) ?? 0))
      ) {
        return [];
      }
      return [
        {
          sequence: row.sequence,
          role: row.role,
          body: content.body,
          laneId: sourceLaneId,
          ...(typeof content.providerLabel === "string"
            ? { providerLabel: content.providerLabel }
            : {}),
          ...(typeof content.model === "string"
            ? { model: content.model }
            : {}),
          ...(typeof content.contextKind === "string"
            ? { contextKind: content.contextKind }
            : {}),
        },
      ];
    });
    const conversationCursors = [
      ...conversation.reduce((advances, message) => {
        if (!message.laneId) return advances;
        advances.set(
          message.laneId,
          Math.max(advances.get(message.laneId) ?? 0, message.sequence),
        );
        return advances;
      }, new Map<string, number>()),
    ].map(([sourceLaneId, toSequenceInclusive]) => ({
      sourceLaneId,
      toSequenceInclusive,
    }));

    return {
      schemaVersion: 1,
      taskId: task.id,
      fromSequenceExclusive: lane.lastEventCursor,
      toSequenceInclusive: deltaEvents.at(-1)?.sequence ?? lane.lastEventCursor,
      objective: task.objective,
      constraints: projections.constraints,
      decisions: projections.decisions,
      git: projections.git,
      artifacts: artifacts.map((artifact) => artifact.uri),
      conversationCursors,
      conversation,
      events: deltaEvents.map((event) => ({
        sequence: event.sequence,
        kind: event.kind,
        summary: eventSummary(event),
      })),
    };
  }

  advanceConversationCursors(
    laneId: string,
    advances: DeltaPackage["conversationCursors"],
    updatedAt: string,
  ): void {
    const upsert = this.dependencies.db.prepare(
      `INSERT INTO event_cursors
       (lane_id, source_lane_id, last_sequence, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(lane_id, source_lane_id) DO UPDATE SET
         last_sequence = MAX(event_cursors.last_sequence, excluded.last_sequence),
         updated_at = excluded.updated_at`,
    );
    this.dependencies.db.transaction(() => {
      for (const advance of advances) {
        upsert.run(
          laneId,
          advance.sourceLaneId,
          advance.toSequenceInclusive,
          updatedAt,
        );
      }
    })();
  }
}

function projectPersistedState(events: CanonicalEvent[]): PersistedProjections {
  let constraints: string[] = [];
  let decisions: string[] = [];
  let git: DeltaPackage["git"] = null;
  for (const event of events) {
    const nextConstraints = stringArray(event.payload.constraints);
    if (nextConstraints) constraints = nextConstraints;
    const nextDecisions = stringArray(event.payload.decisions);
    if (nextDecisions) decisions = nextDecisions;
    const nextGit = gitSnapshot(event.payload.git);
    if (nextGit) git = nextGit;
  }
  return { constraints, decisions, git };
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function gitSnapshot(value: unknown): DeltaPackage["git"] | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const dirtyFiles = stringArray(candidate.dirtyFiles);
  return typeof candidate.branch === "string" && dirtyFiles
    ? { branch: candidate.branch, dirtyFiles }
    : undefined;
}

function eventSummary(event: CanonicalEvent): string {
  return typeof event.payload.summary === "string"
    ? event.payload.summary
    : event.kind;
}
