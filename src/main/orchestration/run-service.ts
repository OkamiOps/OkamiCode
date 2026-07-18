import type { LaneId, RunId } from "../../shared/ids";
import type { LaneRepository } from "../db/repositories/lanes";
import type { RunRepository } from "../db/repositories/runs";
import type { RunHandle } from "../runtime/adapter";
import type { RuntimeRegistry } from "../runtime/registry";
import type { DeltaPackage } from "./delta";

interface RunServiceDependencies {
  lanes: Pick<LaneRepository, "advanceCursor" | "findById">;
  runs: Pick<RunRepository, "insert">;
  runtimes: Pick<RuntimeRegistry, "lookup">;
  createRunId: () => string;
  clock?: () => Date;
}

export interface SendLaneTurnRequest {
  laneId: string;
  nativeSessionId: string;
  input: string;
  delta: DeltaPackage | null;
}

export class RunService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: RunServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async sendTurn(request: SendLaneTurnRequest): Promise<RunHandle> {
    const lane = this.dependencies.lanes.findById(request.laneId);
    if (!lane) throw new Error(`Unknown lane ${request.laneId}`);
    if (request.delta && request.delta.taskId !== lane.taskId) {
      throw new Error("Delta task does not match the target lane");
    }
    if (
      request.delta &&
      request.delta.fromSequenceExclusive !== lane.lastEventCursor
    ) {
      throw new Error("Delta cursor does not match the target lane");
    }
    const runtime = this.dependencies.runtimes.lookup(lane.runtimeKind);
    if (!runtime) throw new Error(`No runtime adapter for ${lane.runtimeKind}`);

    const runId = this.dependencies.createRunId() as RunId;
    const startedAt = this.clock().toISOString();
    this.dependencies.runs.insert({
      id: runId,
      taskId: lane.taskId,
      laneId: lane.id,
      status: "running",
      startedAt,
      finishedAt: null,
      error: null,
    });

    const handle = await runtime.sendTurn({
      runId,
      laneId: lane.id as LaneId,
      nativeSessionId: request.nativeSessionId,
      input: request.delta
        ? `${JSON.stringify(request.delta)}\n\n${request.input}`
        : request.input,
    });

    if (request.delta) {
      this.advanceAcceptedDelta(lane.id, request.delta);
    }
    return handle;
  }

  private advanceAcceptedDelta(laneId: string, delta: DeltaPackage): void {
    const current = this.dependencies.lanes.findById(laneId);
    if (!current) throw new Error(`Unknown lane ${laneId}`);
    if (current.lastEventCursor >= delta.toSequenceInclusive) return;
    this.dependencies.lanes.advanceCursor(
      laneId,
      current.lastEventCursor,
      delta.toSequenceInclusive,
      this.clock().toISOString(),
    );
  }
}
