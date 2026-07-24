import type { LaneId, RunId } from "../../shared/ids";
import type { RuntimeKind } from "../../shared/contracts/lane";
import type { LaneRepository } from "../db/repositories/lanes";
import type { RunRepository } from "../db/repositories/runs";
import type { RunHandle } from "../runtime/adapter";
import type { RuntimeRegistry } from "../runtime/registry";
import { ContextCompiler } from "./context-compiler";
import type { DeltaPackage } from "./delta";
import { afterSuccessfulRunCompletion } from "./successful-run";

interface RunServiceDependencies {
  lanes: Pick<LaneRepository, "advanceCursor" | "findById">;
  runs: Pick<RunRepository, "insert" | "update">;
  runtimes: Pick<RuntimeRegistry, "lookup">;
  createRunId: () => string;
  clock?: () => Date;
  contextCompiler?: Pick<ContextCompiler, "compile">;
  contextBudgetForModel?: (model: string) => {
    maxInputTokens: number;
    reserveForReplyTokens: number;
  };
}

export interface SendLaneTurnRequest {
  effort?: string;
  laneId: string;
  nativeSessionId: string | null;
  input: string;
  delta: DeltaPackage | null;
  runtimeKind?: RuntimeKind;
}

export class RunService {
  private readonly clock: () => Date;
  private readonly contextCompiler: Pick<ContextCompiler, "compile">;

  constructor(private readonly dependencies: RunServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.contextCompiler =
      dependencies.contextCompiler ?? new ContextCompiler();
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
    const runtimeKind = request.runtimeKind ?? lane.runtimeKind;
    const runtime = this.dependencies.runtimes.lookup(runtimeKind);
    if (!runtime) throw new Error(`No runtime adapter for ${runtimeKind}`);

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

    let handle: RunHandle;
    try {
      handle = await runtime.sendTurn({
        runId,
        laneId: lane.id as LaneId,
        nativeSessionId: request.nativeSessionId,
        model: lane.model,
        ...(request.effort ? { effort: request.effort } : {}),
        input: request.delta
          ? `${
              this.contextCompiler.compile(
                request.delta,
                this.dependencies.contextBudgetForModel?.(lane.model) ?? {
                  maxInputTokens: 16_000,
                  reserveForReplyTokens: 4_000,
                },
              ).content
            }\n\n# Nova solicitação\n${request.input}`
          : request.input,
      });
    } catch (error) {
      const failedAt = this.clock().toISOString();
      this.dependencies.runs.update(
        {
          id: runId,
          taskId: lane.taskId,
          laneId: lane.id,
          status: "failed",
          startedAt,
          finishedAt: failedAt,
          error: serializedError(error),
          updatedAt: failedAt,
        },
        lane.updatedAt,
      );
      throw error;
    }

    return request.delta
      ? afterSuccessfulRunCompletion(handle, lane.id, () =>
          this.advanceAcceptedDelta(lane.id, request.delta as DeltaPackage),
        )
      : handle;
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

function serializedError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}
