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

interface LaneHarnessOptions {
  runtime?: RuntimeKind;
  nativeSession?: string;
  cursor?: number;
  events?: number[];
}

export class FakeRuntimeAdapter implements RuntimeAdapter {
  startCalls = 0;
  resumeCalls = 0;
  sendTurnCalls = 0;
  readonly sentTurns: NativeTurnRequest[] = [];
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
    return Promise.resolve({
      laneId: request.laneId,
      nativeSessionId: `new-${request.laneId}`,
      runtimeVersion: "fake-1",
    });
  }

  resume(request: ResumeSessionRequest): Promise<NativeSession> {
    this.resumeCalls += 1;
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
      providerKind: runtime === "codex" ? "chatgpt" : "claude_max",
      model: `${runtime}-test`,
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

  const fakeRuntime = new FakeRuntimeAdapter(runtime);
  const registry = new RuntimeRegistry();
  registry.register(fakeRuntime);
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
  });

  return {
    fx,
    fakeRuntime,
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
        providerKind: runtime === "codex" ? "chatgpt" : "claude_max",
        model: `${runtime}-test`,
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
