import type { LaneId } from "../../shared/ids";
import type { AuditRepository } from "../db/repositories/audit";
import type { LaneRepository } from "../db/repositories/lanes";
import type { RunHandle } from "../runtime/adapter";
import type { RuntimeRegistry } from "../runtime/registry";
import {
  type DeltaPackage,
  type DeltaBuilder,
  type LaneTemperature,
} from "./delta";
import type { RunService } from "./run-service";

interface LaneServiceDependencies {
  lanes: Pick<
    LaneRepository,
    "bindNativeSession" | "findById" | "findNativeSessionBinding"
  >;
  audit: Pick<AuditRepository, "record">;
  runtimes: Pick<RuntimeRegistry, "lookup">;
  deltaBuilder: Pick<DeltaBuilder, "build">;
  runService: Pick<RunService, "sendTurn">;
  createAuditId: () => string;
  clock?: () => Date;
}

export interface OpenLaneOptions {
  inheritTask?: boolean;
}

export interface OpenedLane {
  laneId: string;
  nativeSessionId: string;
  runtimeVersion: string;
  temperature: LaneTemperature;
  delta: DeltaPackage | null;
}

export class LaneService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: LaneServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async open(
    laneId: string,
    options: OpenLaneOptions = {},
  ): Promise<OpenedLane> {
    const lane = this.dependencies.lanes.findById(laneId);
    if (!lane) throw new Error(`Unknown lane ${laneId}`);
    const runtime = this.dependencies.runtimes.lookup(lane.runtimeKind);
    if (!runtime) throw new Error(`No runtime adapter for ${lane.runtimeKind}`);

    const binding = this.dependencies.lanes.findNativeSessionBinding(lane.id);
    const candidateDelta = this.dependencies.deltaBuilder.build(lane.id);
    const hasPendingEvents = candidateDelta.events.length > 0;
    const inheritTask = options.inheritTask ?? true;
    const temperature: LaneTemperature = binding
      ? hasPendingEvents
        ? "stale"
        : "hot"
      : inheritTask
        ? "cold"
        : "clean";
    const delta =
      temperature === "stale" || temperature === "cold" ? candidateDelta : null;
    const request = {
      laneId: lane.id as LaneId,
      cwd: lane.workspacePath ?? process.cwd(),
      model: lane.model,
    };
    const session = binding
      ? await runtime.resume({
          ...request,
          nativeSessionId: binding.nativeSessionId,
        })
      : await runtime.start(request);
    const now = this.clock().toISOString();
    this.dependencies.lanes.bindNativeSession({
      laneId: lane.id,
      nativeSessionId: session.nativeSessionId,
      runtimeVersion: session.runtimeVersion,
      boundAt: binding?.boundAt ?? now,
      updatedAt: now,
    });

    return {
      laneId: lane.id,
      nativeSessionId: session.nativeSessionId,
      runtimeVersion: session.runtimeVersion,
      temperature,
      delta,
    };
  }

  sendTurn(opened: OpenedLane, input: string): Promise<RunHandle> {
    return this.dependencies.runService.sendTurn({
      laneId: opened.laneId,
      nativeSessionId: opened.nativeSessionId,
      input,
      delta: opened.delta,
    });
  }

  async switch(
    sourceLaneId: string,
    targetLaneId: string,
    options: OpenLaneOptions = {},
  ): Promise<OpenedLane> {
    const source = this.dependencies.lanes.findById(sourceLaneId);
    if (!source) throw new Error(`Unknown lane ${sourceLaneId}`);
    const target = this.dependencies.lanes.findById(targetLaneId);
    if (!target) throw new Error(`Unknown lane ${targetLaneId}`);
    if (source.taskId !== target.taskId) {
      throw new Error("Cannot switch lanes across tasks");
    }

    const opened = await this.open(targetLaneId, options);
    this.dependencies.audit.record({
      id: this.dependencies.createAuditId(),
      taskId: target.taskId,
      laneId: target.id,
      runId: null,
      actor: "core",
      action: "lane_switched",
      decision: null,
      capability: null,
      resource: null,
      metadata: { sourceLaneId, targetLaneId },
      occurredAt: this.clock().toISOString(),
    });
    return opened;
  }
}
