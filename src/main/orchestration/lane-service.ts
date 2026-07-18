import type { LaneId } from "../../shared/ids";
import type { AuditRepository } from "../db/repositories/audit";
import type { LaneRecord, LaneRepository } from "../db/repositories/lanes";
import {
  resolveRoute,
  type GatewayAccount,
  type GatewayHealthStatus,
  type ResolvedRoute,
} from "../gateway/route-resolver";
import type { RunHandle } from "../runtime/adapter";
import { claudeGatewayEnvironment } from "../runtime/claude/command";
import type { RuntimeRegistry } from "../runtime/registry";
import {
  type DeltaPackage,
  type DeltaBuilder,
  type LaneTemperature,
} from "./delta";
import type { RunService } from "./run-service";

export interface LaneGatewayRouting {
  port: number;
  bearerToken: string;
  accounts: GatewayAccount[];
  health?: Partial<Record<string, GatewayHealthStatus>>;
  preferNative?: (lane: LaneRecord) => boolean;
}

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
  gateway?: LaneGatewayRouting;
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
  harness: "claude" | "native";
  runtimeKind: "claude" | "codex";
  routeKind: "direct" | "compatible" | "bridged" | "native";
  routeReason: string;
  displayQuotaAccount: string;
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
    const route = this.resolveLaneRoute(lane);
    if (route.kind === "unavailable") {
      throw new Error(`Lane route unavailable: ${route.reason}`);
    }
    const runtimeKind = route.harness === "claude" ? "claude" : route.runtime;
    const runtime = this.dependencies.runtimes.lookup(runtimeKind);
    if (!runtime) throw new Error(`No runtime adapter for ${runtimeKind}`);

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
      ...(route.kind === "compatible" || route.kind === "bridged"
        ? {
            env: claudeGatewayEnvironment({
              profile: route.profile,
              port: this.dependencies.gateway!.port,
              bearerToken: this.dependencies.gateway!.bearerToken,
              model: lane.model,
            }),
          }
        : {}),
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
      harness: route.harness,
      runtimeKind,
      routeKind: route.kind,
      routeReason: route.reason,
      displayQuotaAccount: route.displayQuotaAccount,
    };
  }

  async sendTurn(opened: OpenedLane, input: string): Promise<RunHandle> {
    const run = await this.dependencies.runService.sendTurn({
      laneId: opened.laneId,
      nativeSessionId: opened.nativeSessionId,
      input,
      delta: opened.delta,
      runtimeKind: opened.runtimeKind,
    });
    const lane = this.dependencies.lanes.findById(opened.laneId);
    if (!lane) throw new Error(`Unknown lane ${opened.laneId}`);
    this.dependencies.audit.record({
      id: this.dependencies.createAuditId(),
      taskId: lane.taskId,
      laneId: lane.id,
      runId: run.runId,
      actor: "core",
      action: "lane_route_resolved",
      decision: null,
      capability: null,
      resource: null,
      metadata: {
        harness: opened.harness,
        routeKind: opened.routeKind,
        routeReason: opened.routeReason,
        displayQuotaAccount: opened.displayQuotaAccount,
      },
      occurredAt: this.clock().toISOString(),
    });
    return run;
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

  private resolveLaneRoute(lane: LaneRecord): ResolvedRoute {
    const gateway = this.dependencies.gateway;
    if (gateway) {
      return resolveRoute({
        model: lane.model,
        accounts: gateway.accounts,
        health: gateway.health,
        preferNative: gateway.preferNative?.(lane),
      });
    }
    if (lane.runtimeKind === "claude") {
      return {
        harness: "claude",
        kind: "direct",
        runtime: "claude",
        reason: "claude_model",
        displayQuotaAccount: "Claude subscription",
      };
    }
    return {
      harness: "native",
      kind: "native",
      runtime: lane.runtimeKind,
      reason: "native_requested",
      displayQuotaAccount: "ChatGPT subscription",
    };
  }
}
