import type { CanonicalEvent } from "../../shared/contracts/event";
import type { RuntimeKind } from "../../shared/contracts/lane";
import type { LaneId, RunId } from "../../shared/ids";

export interface RuntimeHealth {
  available: boolean;
  protocolSupported: boolean;
  version: string | null;
  detail?: string;
  transportId?: string;
  transportKind?: "oauth" | "api" | "cli" | "acp" | "embedded";
  entitlement?: "subscription" | "token_plan" | "provider_managed" | "payg";
}

export class NativeSessionUnavailableError extends Error {
  constructor(
    readonly runtime: RuntimeKind,
    readonly reason: "provider_session_missing",
  ) {
    super(`${runtime} provider session is unavailable`);
    this.name = "NativeSessionUnavailableError";
  }
}

export interface StartSessionRequest {
  laneId: LaneId;
  cwd: string;
  model?: string;
  permissionMode?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ResumeSessionRequest extends StartSessionRequest {
  nativeSessionId: string;
}

interface NativeSessionBase {
  laneId: LaneId;
  runtimeVersion: string;
}

export interface AuthoritativeNativeSession extends NativeSessionBase {
  bindingState: "authoritative";
  nativeSessionId: string;
  migration?: {
    fromNativeSessionId: string;
    toNativeSessionId: string;
    rehydrationRequired: true;
  };
  rehydration?: {
    required: true;
    reason: "transport_continuation_unavailable";
  };
}

export interface DeferredNativeSession extends NativeSessionBase {
  bindingState: "deferred";
  nativeSessionId: null;
}

export type NativeSession = AuthoritativeNativeSession | DeferredNativeSession;

export interface NativeTurnRequest {
  runId: RunId;
  laneId: LaneId;
  nativeSessionId: string | null;
  input: string;
  model?: string;
  effort?: string;
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
