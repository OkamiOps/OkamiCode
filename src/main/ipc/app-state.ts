import { randomUUID } from "node:crypto";
import type { Database } from "../db/connection";
import { AuditRepository } from "../db/repositories/audit";
import { EventRepository } from "../db/repositories/events";
import { LaneRepository } from "../db/repositories/lanes";
import { RunRepository } from "../db/repositories/runs";
import { TaskRepository } from "../db/repositories/tasks";
import { DeltaBuilder } from "../orchestration/delta";
import {
  LaneService,
  type LaneGatewayRouting,
} from "../orchestration/lane-service";
import { RunService } from "../orchestration/run-service";
import { ApprovalRepository } from "../policy/approval";
import { PolicyEngine } from "../policy/engine";
import { LeaseRepository } from "../policy/lease";
import type { RuntimeRegistry } from "../runtime/registry";
import type { ProviderCredentialVault } from "../runtime/sdk/provider-credential-vault";

export interface AppState {
  database: Database;
  tasks: TaskRepository;
  lanes: LaneRepository;
  runs: RunRepository;
  events: EventRepository;
  approvals: ApprovalRepository;
  policyEngine: PolicyEngine;
  runtimes: RuntimeRegistry;
  laneService: LaneService;
  runService: RunService;
  createId: () => string;
  clock: () => Date;
  reportBackgroundError: (error: unknown) => void;
  providerCredentials?: Pick<
    ProviderCredentialVault,
    "set" | "get" | "has" | "delete"
  >;
}

export interface CreateAppStateOptions {
  database: Database;
  runtimes: RuntimeRegistry;
  gateway?: LaneGatewayRouting;
  createId?: () => string;
  clock?: () => Date;
  reportBackgroundError?: (error: unknown) => void;
  providerCredentials?: Pick<
    ProviderCredentialVault,
    "set" | "get" | "has" | "delete"
  >;
}

export function createAppState(options: CreateAppStateOptions): AppState {
  const createId = options.createId ?? randomUUID;
  const clock = options.clock ?? (() => new Date());
  const tasks = new TaskRepository(options.database);
  const lanes = new LaneRepository(options.database);
  const runs = new RunRepository(options.database);
  const events = new EventRepository(options.database);
  const audit = new AuditRepository(options.database);
  const approvals = new ApprovalRepository(options.database);
  const leases = new LeaseRepository(options.database);
  const policyEngine = new PolicyEngine({
    leases,
    approvals,
    audit,
    createId,
  });
  const deltaBuilder = new DeltaBuilder({
    db: options.database,
    tasks,
    lanes,
    events,
  });
  const runService = new RunService({
    lanes,
    runs,
    runtimes: options.runtimes,
    createRunId: createId,
    clock,
  });
  const laneService = new LaneService({
    lanes,
    audit,
    runtimes: options.runtimes,
    deltaBuilder,
    runService,
    createAuditId: createId,
    clock,
    gateway: options.gateway,
  });

  return {
    database: options.database,
    tasks,
    lanes,
    runs,
    events,
    approvals,
    policyEngine,
    runtimes: options.runtimes,
    laneService,
    runService,
    createId,
    clock,
    reportBackgroundError:
      options.reportBackgroundError ??
      (() => console.error("Workbench IPC event forwarding failed")),
    providerCredentials: options.providerCredentials,
  };
}
