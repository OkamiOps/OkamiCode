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
      events: deltaEvents.map((event) => ({
        sequence: event.sequence,
        kind: event.kind,
        summary: eventSummary(event),
      })),
    };
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
