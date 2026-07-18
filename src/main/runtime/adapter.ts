import type { CanonicalEvent } from "../../shared/contracts/event";
import type { RuntimeKind } from "../../shared/contracts/lane";
import type { LaneId, RunId } from "../../shared/ids";

export interface RuntimeHealth {
  available: boolean;
  protocolSupported: boolean;
  version: string | null;
  detail?: string;
}

export interface StartSessionRequest {
  laneId: LaneId;
  cwd: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResumeSessionRequest extends StartSessionRequest {
  nativeSessionId: string;
}

export interface NativeSession {
  laneId: LaneId;
  nativeSessionId: string;
  runtimeVersion: string;
}

export interface NativeTurnRequest {
  runId: RunId;
  laneId: LaneId;
  nativeSessionId: string;
  input: string;
}

export interface RunHandle {
  runId: RunId;
  events: AsyncIterable<CanonicalEvent>;
}

export interface ApprovalResponse {
  runId: RunId;
  approvalId: string;
  decision: "allow_once" | "deny";
  payload?: Record<string, unknown>;
}

export interface UsageCapabilities {
  quotaSnapshot: boolean;
  contextSnapshot: boolean;
  activitySnapshot: boolean;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  detect(): Promise<RuntimeHealth>;
  start(request: StartSessionRequest): Promise<NativeSession>;
  resume(request: ResumeSessionRequest): Promise<NativeSession>;
  sendTurn(request: NativeTurnRequest): Promise<RunHandle>;
  respondToApproval(response: ApprovalResponse): Promise<void>;
  cancel(runId: RunId): Promise<void>;
  usageCapabilities(): UsageCapabilities;
}
