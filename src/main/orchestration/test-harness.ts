import { randomUUID } from "node:crypto";
import type { CanonicalEvent } from "../../shared/contracts/event";
import type { RuntimeKind } from "../../shared/contracts/lane";
import { createTestDatabase, type TestDatabase } from "../db/test-support";
import type {
  NativeSession,
  NativeTurnRequest,
  ResumeSessionRequest,
  RunHandle,
  RuntimeAdapter,
  RuntimeHealth,
  StartSessionRequest,
  UsageCapabilities,
} from "../runtime/adapter";
import { RuntimeRegistry } from "../runtime/registry";
import { DeltaBuilder } from "./delta";
import { LaneService } from "./lane-service";
import { RunService } from "./run-service";
import type { LaneGatewayRouting } from "./lane-service";

interface LaneHarnessOptions {
  runtime?: RuntimeKind;
  model?: string;
  nativeSession?: string;
  cursor?: number;
  events?: number[];
  gateway?: LaneGatewayRouting;
}

export class FakeRuntimeAdapter implements RuntimeAdapter {
  startCalls = 0;
  resumeCalls = 0;
  sendTurnCalls = 0;
  readonly sentTurns: NativeTurnRequest[] = [];
  readonly startRequests: StartSessionRequest[] = [];
  readonly resumeRequests: ResumeSessionRequest[] = [];
  rejectNextTurn = false;

  constructor(readonly kind: RuntimeKind) {}

  detect(): Promise<RuntimeHealth> {
    return Promise.resolve({
      available: true,
      protocolSupported: true,
      version: "fake-1",
    });
  }

  start(request: StartSessionRequest): Promise<NativeSession> {
    this.startCalls += 1;
    this.startRequests.push(request);
    return Promise.resolve({
      laneId: request.laneId,
      nativeSessionId: `new-${request.laneId}`,
      runtimeVersion: "fake-1",
    });
  }

  resume(request: ResumeSessionRequest): Promise<NativeSession> {
    this.resumeCalls += 1;
    this.resumeRequests.push(request);
    return Promise.resolve({
      laneId: request.laneId,
      nativeSessionId: request.nativeSessionId,
      runtimeVersion: "fake-1",
    });
  }

  sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    this.sendTurnCalls += 1;
    this.sentTurns.push(request);
    if (this.rejectNextTurn) {
      this.rejectNextTurn = false;
      return Promise.reject(new Error("runtime rejected delta"));
    }
    return Promise.resolve({
      runId: request.runId,
      events: emptyEvents(),
    });
  }

  respondToApproval(): Promise<void> {
    return Promise.resolve();
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: false,
      contextSnapshot: false,
      activitySnapshot: false,
    };
  }
}

export interface LaneHarness {
  fx: TestDatabase;
  fakeRuntime: FakeRuntimeAdapter;
  runtimes: {
    claude: FakeRuntimeAdapter;
    codex: FakeRuntimeAdapter;
    cursor: FakeRuntimeAdapter;
  };
  service: LaneService;
  buildDelta(): ReturnType<DeltaBuilder["build"]>;
  openExisting(): ReturnType<LaneService["open"]>;
  appendEvent(sequence: number, payload?: Record<string, unknown>): void;
  addArtifact(uri: string): void;
  addLane(options?: { nativeSession?: string; cursor?: number }): string;
}

export function createLaneHarness(
  options: LaneHarnessOptions = {},
): LaneHarness {
  const fx = createTestDatabase();
  const runtime = options.runtime ?? "claude";
  const lane = required(fx.lanes.findById(fx.laneId));
  fx.lanes.update(
    {
      ...lane,
      runtimeKind: runtime,
      providerKind: providerForRuntime(runtime),
      model: options.model ?? modelForRuntime(runtime),
      lastEventCursor: options.cursor ?? 0,
      updatedAt: nextTimestamp(lane.updatedAt),
    },
    lane.updatedAt,
  );

  if (options.nativeSession) {
    fx.lanes.bindNativeSession({
      laneId: fx.laneId,
      nativeSessionId: options.nativeSession,
      runtimeVersion: "fake-1",
      boundAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  for (const sequence of options.events ?? []) {
    appendEvent(fx, sequence);
  }

  const runtimes = {
    claude: new FakeRuntimeAdapter("claude"),
    codex: new FakeRuntimeAdapter("codex"),
    cursor: new FakeRuntimeAdapter("cursor"),
  };
  const fakeRuntime = runtimes[runtime];
  const registry = new RuntimeRegistry();
  registry.register(runtimes.claude);
  registry.register(runtimes.codex);
  registry.register(runtimes.cursor);
  const deltaBuilder = new DeltaBuilder({
    db: fx.db,
    tasks: fx.tasks,
    lanes: fx.lanes,
    events: fx.events,
  });
  const runService = new RunService({
    lanes: fx.lanes,
    runs: fx.runs,
    runtimes: registry,
    createRunId: randomUUID,
  });
  const service = new LaneService({
    lanes: fx.lanes,
    audit: fx.audit,
    runtimes: registry,
    deltaBuilder,
    runService,
    createAuditId: randomUUID,
    gateway: options.gateway,
  });

  return {
    fx,
    fakeRuntime,
    runtimes,
    service,
    buildDelta: () => deltaBuilder.build(fx.laneId),
    openExisting: () => service.open(fx.laneId),
    appendEvent(sequence, payload = {}) {
      appendEvent(fx, sequence, payload);
    },
    addArtifact(uri) {
      fx.db
        .prepare(
          `INSERT INTO artifacts
           (id, run_id, kind, uri, content_hash, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          fx.runId,
          "file",
          uri,
          `hash-${uri}`,
          "{}",
          new Date().toISOString(),
        );
    },
    addLane(laneOptions = {}) {
      const id = randomUUID();
      const now = new Date().toISOString();
      fx.lanes.insert({
        id,
        taskId: fx.taskId,
        runtimeKind: runtime,
        providerKind: providerForRuntime(runtime),
        model: options.model ?? modelForRuntime(runtime),
        status: "ready",
        workspacePath: null,
        lastEventCursor: laneOptions.cursor ?? 0,
        createdAt: now,
        updatedAt: now,
      });
      if (laneOptions.nativeSession) {
        fx.lanes.bindNativeSession({
          laneId: id,
          nativeSessionId: laneOptions.nativeSession,
          runtimeVersion: "fake-1",
          boundAt: now,
          updatedAt: now,
        });
      }
      return id;
    },
  };
}

function providerForRuntime(runtime: RuntimeKind) {
  if (runtime === "claude") return "claude_max" as const;
  if (runtime === "codex") return "chatgpt" as const;
  return "cursor" as const;
}

function modelForRuntime(runtime: RuntimeKind): string {
  if (runtime === "claude") return "claude-test";
  if (runtime === "codex") return "gpt-test";
  return "default";
}

function appendEvent(
  fx: TestDatabase,
  sequence: number,
  payload: Record<string, unknown> = {},
): void {
  fx.events.append(
    fx.event({
      sequence,
      nativeEventId: `native-${sequence}`,
      kind: "message_completed",
      payload: { summary: `event-${sequence}`, ...payload },
    }),
  );
}

async function* emptyEvents(): AsyncIterable<CanonicalEvent> {}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing harness fixture");
  return value;
}

function nextTimestamp(timestamp: string): string {
  return new Date(Date.parse(timestamp) + 1).toISOString();
}
