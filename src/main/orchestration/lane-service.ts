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
import type { RuntimeKind } from "../../shared/contracts/lane";
import path from "node:path";
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
  gatewayConfigRoot?: string;
  accounts: GatewayAccount[];
  health?: Partial<Record<string, GatewayHealthStatus>>;
  preferNative?: (lane: LaneRecord) => boolean;
}

interface LaneServiceDependencies {
  lanes: Pick<
    LaneRepository,
    | "bindNativeSessionIfAbsentOrEqual"
    | "findById"
    | "findNativeSessionBinding"
    | "list"
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
  workspaceFallbackPath?: string;
}

export interface OpenedLane {
  laneId: string;
  taskId: string;
  nativeSessionId: string | null;
  nativeSessionIdPrefix: string | null;
  bindingState: "authoritative" | "deferred";
  runtimeVersion: string;
  temperature: LaneTemperature;
  delta: DeltaPackage | null;
  pendingDeltaEvents: number;
  harness: "claude" | "native";
  runtimeKind: RuntimeKind;
  providerAccountLabel: string;
  model: string;
  routeKind: "direct" | "compatible" | "bridged" | "native";
  routeReason: string;
  displayQuotaAccount: string;
  permissionMode: string | null;
  workspacePath: string | null;
  status: LaneRecord["status"];
}

export interface LaneSummary {
  laneId: string;
  taskId: string;
  harness: "claude" | "native";
  runtimeKind: RuntimeKind;
  runtimeVersion: string | null;
  providerAccountLabel: string;
  model: string;
  routeKind: "direct" | "compatible" | "bridged" | "native" | "unavailable";
  routeReason: string;
  displayQuotaAccount: string;
  permissionMode: string | null;
  workspacePath: string | null;
  nativeSessionIdPrefix: string | null;
  status: LaneRecord["status"];
  temperature: LaneTemperature;
  pendingDeltaEvents: number;
}

export class LaneService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: LaneServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  list(taskId?: string): LaneSummary[] {
    return this.dependencies.lanes.list(taskId).map((lane) => {
      const route = this.resolveLaneRoute(lane);
      const binding = this.dependencies.lanes.findNativeSessionBinding(lane.id);
      const pendingDeltaEvents = this.dependencies.deltaBuilder.build(lane.id)
        .events.length;
      const temperature: LaneTemperature = binding
        ? pendingDeltaEvents > 0
          ? "stale"
          : "hot"
        : "cold";
      const runtimeKind =
        route.kind === "unavailable"
          ? lane.runtimeKind
          : route.harness === "claude"
            ? "claude"
            : route.runtime;
      return {
        laneId: lane.id,
        taskId: lane.taskId,
        harness: route.harness,
        runtimeKind,
        runtimeVersion: binding?.runtimeVersion ?? null,
        providerAccountLabel: providerAccountLabel(lane),
        model: lane.model,
        routeKind: route.kind,
        routeReason: route.reason,
        displayQuotaAccount: route.displayQuotaAccount,
        permissionMode: lane.permissionMode ?? "manual",
        workspacePath: lane.workspacePath,
        nativeSessionIdPrefix: binding
          ? nativeSessionIdPrefix(binding.nativeSessionId)
          : null,
        status: lane.status,
        temperature,
        pendingDeltaEvents,
      };
    });
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
      cwd: lane.workspacePath ?? options.workspaceFallbackPath ?? process.cwd(),
      model: lane.model,
      // The lane's stored mode is what the CLI is spawned with; "manual"
      // stays the default for lanes that never chose one.
      permissionMode: lane.permissionMode ?? "manual",
      ...(route.kind === "compatible" || route.kind === "bridged"
        ? {
            env: claudeGatewayEnvironment({
              profile: route.profile,
              port: this.dependencies.gateway!.port,
              bearerToken: `${this.dependencies.gateway!.bearerToken}.${lane.id}`,
              model: lane.model,
              stableConfigDirectory: this.dependencies.gateway!
                .gatewayConfigRoot
                ? path.join(
                    this.dependencies.gateway!.gatewayConfigRoot,
                    lane.id,
                  )
                : undefined,
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
    const nativeSessionId =
      session.bindingState === "authoritative" ? session.nativeSessionId : null;
    if (nativeSessionId) {
      const now = this.clock().toISOString();
      this.dependencies.lanes.bindNativeSessionIfAbsentOrEqual({
        laneId: lane.id,
        nativeSessionId,
        runtimeVersion: session.runtimeVersion,
        boundAt: binding?.boundAt ?? now,
        updatedAt: now,
      });
    }

    return {
      laneId: lane.id,
      taskId: lane.taskId,
      nativeSessionId,
      nativeSessionIdPrefix: nativeSessionId
        ? nativeSessionIdPrefix(nativeSessionId)
        : null,
      bindingState: session.bindingState,
      runtimeVersion: session.runtimeVersion,
      temperature,
      delta,
      pendingDeltaEvents: candidateDelta.events.length,
      harness: route.harness,
      runtimeKind,
      providerAccountLabel: providerAccountLabel(lane),
      model: lane.model,
      routeKind: route.kind,
      routeReason: route.reason,
      displayQuotaAccount: route.displayQuotaAccount,
      permissionMode: lane.permissionMode ?? "manual",
      workspacePath: lane.workspacePath,
      status: lane.status,
    };
  }

  async sendTurn(
    opened: OpenedLane,
    input: string,
    effort?: string,
  ): Promise<RunHandle> {
    const run = await this.dependencies.runService.sendTurn({
      laneId: opened.laneId,
      nativeSessionId: opened.nativeSessionId,
      input,
      delta: opened.delta,
      runtimeKind: opened.runtimeKind,
      ...(effort ? { effort } : {}),
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

  promoteNativeSession(
    opened: OpenedLane,
    event: {
      laneId: string;
      nativeSessionId: string;
      runtimeVersion?: string;
    },
  ): void {
    if (event.laneId !== opened.laneId) {
      throw new Error(
        "Native session event does not belong to the opened lane",
      );
    }
    const lane = this.dependencies.lanes.findById(opened.laneId);
    if (!lane) throw new Error(`Unknown lane ${opened.laneId}`);
    const route = this.resolveLaneRoute(lane);
    const expectedRuntime =
      route.kind === "unavailable"
        ? lane.runtimeKind
        : route.harness === "claude"
          ? "claude"
          : route.runtime;
    if (opened.runtimeKind !== expectedRuntime) {
      throw new Error("Native session event runtime does not match the lane");
    }
    const now = this.clock().toISOString();
    this.dependencies.lanes.bindNativeSessionIfAbsentOrEqual({
      laneId: lane.id,
      nativeSessionId: event.nativeSessionId,
      runtimeVersion: event.runtimeVersion ?? opened.runtimeVersion,
      boundAt: now,
      updatedAt: now,
    });
    opened.nativeSessionId = event.nativeSessionId;
    opened.nativeSessionIdPrefix = nativeSessionIdPrefix(event.nativeSessionId);
    opened.runtimeVersion = event.runtimeVersion ?? opened.runtimeVersion;
    opened.bindingState = "authoritative";
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
    // Cursor owns its model routing and subscription. A Claude/GPT model name
    // selected inside Cursor must never be mistaken for a gateway request.
    if (
      lane.runtimeKind === "cursor" ||
      lane.runtimeKind === "agy" ||
      lane.runtimeKind === "grok" ||
      lane.runtimeKind === "mimo"
    ) {
      return {
        harness: "native",
        kind: "native",
        runtime: lane.runtimeKind,
        reason: "native_requested",
        displayQuotaAccount:
          lane.runtimeKind === "agy"
            ? "Antigravity subscription"
            : lane.runtimeKind === "grok"
              ? "Grok subscription"
              : lane.runtimeKind === "mimo"
                ? "MiMo subscription"
                : "Cursor subscription",
      };
    }
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

function providerAccountLabel(lane: LaneRecord): string {
  if (lane.providerKind === "claude_max") return "Claude Max";
  if (lane.providerKind === "chatgpt") return "ChatGPT";
  if (lane.providerKind === "antigravity") return "Antigravity";
  if (lane.providerKind === "grok") return "Grok";
  return "Cursor";
}

function nativeSessionIdPrefix(nativeSessionId: string): string {
  return nativeSessionId.length > 8
    ? `${nativeSessionId.slice(0, 8)}…`
    : nativeSessionId;
}
