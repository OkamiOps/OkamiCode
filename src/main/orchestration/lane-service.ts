import type { LaneId } from "../../shared/ids";
import type { AuditRepository } from "../db/repositories/audit";
import type { LaneRecord, LaneRepository } from "../db/repositories/lanes";
import type {
  GatewayAccount,
  GatewayHealthStatus,
  ResolvedRoute,
} from "../gateway/route-resolver";
import type { RunHandle } from "../runtime/adapter";
import type { RuntimeKind } from "../../shared/contracts/lane";
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
    | "compareAndMigrateNativeSession"
    | "acknowledgeNativeSessionRehydration"
    | "findById"
    | "findNativeSessionBinding"
    | "list"
  >;
  audit: Pick<AuditRepository, "record">;
  runtimes: Pick<RuntimeRegistry, "lookup">;
  deltaBuilder: Pick<DeltaBuilder, "build" | "advanceConversationCursors">;
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
  inheritTask?: boolean;
  rehydrationRequired?: boolean;
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
        ? binding.rehydrationRequired
          ? "cold"
          : pendingDeltaEvents > 0
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
    const initialTemperature: LaneTemperature = binding
      ? hasPendingEvents
        ? "stale"
        : "hot"
      : inheritTask
        ? "cold"
        : "clean";
    const request = {
      laneId: lane.id as LaneId,
      cwd: lane.workspacePath ?? options.workspaceFallbackPath ?? process.cwd(),
      model: lane.model,
      // Permission policy belongs to Okami. A transport may translate this
      // value, but provider routing must never inject another provider's
      // credentials or harness environment.
      permissionMode: lane.permissionMode ?? "manual",
    };
    const session = binding
      ? await runtime.resume({
          ...request,
          nativeSessionId: binding.nativeSessionId,
        })
      : await runtime.start(request);
    const nativeSessionId =
      session.bindingState === "authoritative" ? session.nativeSessionId : null;
    const migration =
      session.bindingState === "authoritative" ? session.migration : undefined;
    if (nativeSessionId) {
      const now = this.clock().toISOString();
      if (migration) {
        if (
          !binding ||
          migration.fromNativeSessionId !== binding.nativeSessionId ||
          migration.toNativeSessionId !== nativeSessionId
        ) {
          throw new Error("Native session migration signal is inconsistent");
        }
        this.dependencies.lanes.compareAndMigrateNativeSession({
          laneId: lane.id,
          runtimeKind,
          fromNativeSessionId: migration.fromNativeSessionId,
          toNativeSessionId: migration.toNativeSessionId,
          runtimeVersion: session.runtimeVersion,
          updatedAt: now,
        });
      } else {
        this.dependencies.lanes.bindNativeSessionIfAbsentOrEqual({
          laneId: lane.id,
          nativeSessionId,
          runtimeVersion: session.runtimeVersion,
          boundAt: binding?.boundAt ?? now,
          updatedAt: now,
        });
      }
    }
    const rehydrationRequired =
      session.bindingState === "authoritative" &&
      (migration?.rehydrationRequired === true ||
        binding?.rehydrationRequired === true);
    const temperature: LaneTemperature = rehydrationRequired
      ? "cold"
      : initialTemperature;
    const delta = rehydrationRequired
      ? this.dependencies.deltaBuilder.build(lane.id, {
          forceFullContext: true,
        })
      : temperature === "stale" || temperature === "cold"
        ? candidateDelta
        : null;

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
      inheritTask,
      rehydrationRequired,
    };
  }

  async sendTurn(
    opened: OpenedLane,
    input: string,
    effort?: string,
  ): Promise<RunHandle> {
    const refreshedDelta =
      opened.inheritTask === false
        ? null
        : this.dependencies.deltaBuilder.build(opened.laneId, {
            forceFullContext: opened.rehydrationRequired,
          });
    const delta =
      refreshedDelta &&
      (opened.temperature === "cold" ||
        refreshedDelta.events.length > 0 ||
        refreshedDelta.conversation.length > 0)
        ? refreshedDelta
        : null;
    const run = await this.dependencies.runService.sendTurn({
      laneId: opened.laneId,
      nativeSessionId: opened.nativeSessionId,
      input,
      delta,
      runtimeKind: opened.runtimeKind,
      ...(effort ? { effort } : {}),
    });
    // The opened projection is retained by the renderer between turns. Once
    // its delta is accepted, keeping it here would replay an obsolete cursor
    // on the next Enter press and correctly trigger a conflict in RunService.
    if (delta) {
      this.dependencies.deltaBuilder.advanceConversationCursors(
        opened.laneId,
        delta.conversationCursors,
        this.clock().toISOString(),
      );
      opened.delta = null;
      opened.pendingDeltaEvents = 0;
      opened.temperature = "hot";
    }
    if (opened.rehydrationRequired) {
      if (!opened.nativeSessionId) {
        throw new Error("Migrated lane is missing an authoritative session");
      }
      this.dependencies.lanes.acknowledgeNativeSessionRehydration(
        opened.laneId,
        opened.nativeSessionId,
        this.clock().toISOString(),
      );
      opened.rehydrationRequired = false;
    }
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
    if (lane.runtimeKind !== "claude") {
      return {
        harness: "native",
        kind: "native",
        runtime: lane.runtimeKind,
        reason: "native_requested",
        displayQuotaAccount: transportAccountLabel(lane.runtimeKind),
      };
    }
    return {
      harness: "claude",
      kind: "direct",
      runtime: "claude",
      reason: "claude_model",
      displayQuotaAccount: "Claude subscription",
    };
  }
}

function transportAccountLabel(runtime: RuntimeKind): string {
  if (runtime === "codex") return "OpenAI / Codex transport";
  if (runtime === "cursor") return "Cursor subscription";
  if (runtime === "agy") return "Antigravity subscription";
  if (runtime === "grok") return "xAI / Grok transport";
  if (runtime === "mimo") return "MiMo transport";
  if (runtime === "minimax") return "MiniMax transport";
  if (runtime === "opencode") return "OpenCode provider account";
  return "Claude subscription";
}

function providerAccountLabel(lane: LaneRecord): string {
  if (lane.providerKind === "claude_max") return "Claude Max";
  if (lane.providerKind === "chatgpt") return "ChatGPT";
  if (lane.providerKind === "antigravity") return "Antigravity";
  if (lane.providerKind === "grok") return "Grok";
  if (lane.providerKind === "mimo") return "MiMo";
  if (lane.providerKind === "minimax") return "MiniMax";
  if (lane.providerKind === "multi_provider") return "OpenCode";
  return "Cursor";
}

function nativeSessionIdPrefix(nativeSessionId: string): string {
  return nativeSessionId.length > 8
    ? `${nativeSessionId.slice(0, 8)}…`
    : nativeSessionId;
}
