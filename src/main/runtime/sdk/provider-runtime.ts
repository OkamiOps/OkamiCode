import type { RuntimeKind } from "../../../shared/contracts/lane";
import type {
  ApprovalResponse,
  NativeSession,
  NativeTurnRequest,
  ResumeSessionRequest,
  RunHandle,
  RuntimeAdapter,
  RuntimeHealth,
  StartSessionRequest,
  UsageCapabilities,
} from "../adapter";
import type { RuntimeTransport } from "../manifest";

const SESSION_PREFIX = "okami:v1:";
const RETIRED_TRANSPORT_ALIASES = {
  claude: [],
  codex: [],
  cursor: [],
  agy: [],
  grok: [],
  mimo: ["mimo-cli"],
  minimax: ["minimax-cli"],
  opencode: [],
} as const satisfies Record<RuntimeKind, readonly string[]>;

export interface RuntimeTransportCandidate {
  descriptor: RuntimeTransport;
  adapter: RuntimeAdapter;
}

interface DecodedBinding {
  transportId: string;
  nativeSessionId: string;
}

export class ProviderRuntimeAdapter implements RuntimeAdapter {
  private readonly candidates: RuntimeTransportCandidate[];
  private readonly candidatesById: Map<string, RuntimeTransportCandidate>;
  private readonly laneBindings = new Map<string, RuntimeTransportCandidate>();
  private readonly runBindings = new Map<string, RuntimeTransportCandidate>();

  constructor(
    readonly kind: RuntimeKind,
    candidates: RuntimeTransportCandidate[],
  ) {
    if (candidates.length === 0) {
      throw new Error(`Provider ${kind} requires at least one transport`);
    }
    for (const candidate of candidates) {
      if (candidate.adapter.kind !== kind) {
        throw new Error(
          `Transport ${candidate.descriptor.id} belongs to ${candidate.adapter.kind}, not ${kind}`,
        );
      }
    }
    this.candidates = [...candidates].sort(
      (left, right) =>
        left.descriptor.priority - right.descriptor.priority ||
        left.descriptor.id.localeCompare(right.descriptor.id),
    );
    this.candidatesById = new Map(
      this.candidates.map((candidate) => [candidate.descriptor.id, candidate]),
    );
  }

  async detect(): Promise<RuntimeHealth> {
    const selected = await this.selectHealthy();
    if (selected) return selected.health;
    const details = await Promise.all(
      this.candidates.map(async ({ descriptor, adapter }) => {
        const health = await safeDetect(adapter);
        return `${descriptor.id}: ${health.detail ?? "unavailable"}`;
      }),
    );
    return {
      available: false,
      protocolSupported: false,
      version: null,
      detail: details.join("; "),
    };
  }

  async start(request: StartSessionRequest): Promise<NativeSession> {
    const selected = await this.selectHealthy();
    if (!selected) {
      const health = await this.detect();
      throw new Error(health.detail ?? `No healthy transport for ${this.kind}`);
    }
    const session = await selected.candidate.adapter.start(request);
    this.laneBindings.set(request.laneId, selected.candidate);
    return bindSession(session, selected.candidate.descriptor.id);
  }

  async resume(request: ResumeSessionRequest): Promise<NativeSession> {
    const decoded = decodeSession(request.nativeSessionId);
    const candidate = decoded
      ? this.resumeCandidate(decoded.transportId)
      : this.legacySessionOwner();
    const session = await candidate.adapter.resume({
      ...request,
      nativeSessionId: decoded?.nativeSessionId ?? request.nativeSessionId,
    });
    this.laneBindings.set(request.laneId, candidate);
    return decoded
      ? bindSession(session, candidate.descriptor.id)
      : preserveLegacySession(session, request.nativeSessionId);
  }

  async sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    const decoded = request.nativeSessionId
      ? decodeSession(request.nativeSessionId)
      : undefined;
    const candidate = decoded
      ? this.requireCandidate(decoded.transportId)
      : this.laneBindings.get(request.laneId);
    if (!candidate) {
      throw new Error(
        `No transport binding for ${this.kind} lane ${request.laneId}`,
      );
    }
    const handle = await candidate.adapter.sendTurn({
      ...request,
      nativeSessionId: decoded?.nativeSessionId ?? request.nativeSessionId,
    });
    this.runBindings.set(request.runId, candidate);
    return handle;
  }

  async respondToApproval(response: ApprovalResponse): Promise<void> {
    const candidate = this.runBindings.get(response.runId);
    if (!candidate) {
      throw new Error(`No transport owns run ${response.runId}`);
    }
    await candidate.adapter.respondToApproval(response);
  }

  async cancel(runId: NativeTurnRequest["runId"]): Promise<void> {
    await this.runBindings.get(runId)?.adapter.cancel(runId);
  }

  usageCapabilities(): UsageCapabilities {
    return this.candidates.reduce<UsageCapabilities>(
      (combined, candidate) => {
        const capabilities = candidate.adapter.usageCapabilities();
        return {
          quotaSnapshot: combined.quotaSnapshot || capabilities.quotaSnapshot,
          contextSnapshot:
            combined.contextSnapshot || capabilities.contextSnapshot,
          activitySnapshot:
            combined.activitySnapshot || capabilities.activitySnapshot,
        };
      },
      {
        quotaSnapshot: false,
        contextSnapshot: false,
        activitySnapshot: false,
      },
    );
  }

  private async selectHealthy(): Promise<
    | {
        candidate: RuntimeTransportCandidate;
        health: RuntimeHealth;
      }
    | undefined
  > {
    for (const candidate of this.candidates) {
      const detected = await safeDetect(candidate.adapter);
      if (detected.available && detected.protocolSupported) {
        return {
          candidate,
          health: {
            ...detected,
            transportId: candidate.descriptor.id,
            transportKind: candidate.descriptor.kind,
            entitlement: candidate.descriptor.entitlement,
          },
        };
      }
    }
    return undefined;
  }

  private requireCandidate(transportId: string): RuntimeTransportCandidate {
    const candidate = this.candidatesById.get(transportId);
    if (!candidate) {
      throw new Error(`Unknown ${this.kind} transport binding ${transportId}`);
    }
    return candidate;
  }

  private resumeCandidate(transportId: string): RuntimeTransportCandidate {
    const candidate = this.candidatesById.get(transportId);
    if (candidate) return candidate;
    const retiredAliases = RETIRED_TRANSPORT_ALIASES[
      this.kind
    ] as readonly string[];
    return retiredAliases.includes(transportId)
      ? this.legacySessionOwner()
      : this.requireCandidate(transportId);
  }

  private legacySessionOwner(): RuntimeTransportCandidate {
    const owners = this.candidates.filter(
      ({ descriptor }) => descriptor.legacySessionOwner,
    );
    if (owners.length !== 1) {
      throw new Error(
        `Provider ${this.kind} needs exactly one legacy session owner`,
      );
    }
    return owners[0] as RuntimeTransportCandidate;
  }
}

function bindSession(
  session: NativeSession,
  transportId: string,
): NativeSession {
  if (session.bindingState === "deferred") return session;
  return {
    ...session,
    nativeSessionId: encodeSession(transportId, session.nativeSessionId),
  };
}

function preserveLegacySession(
  session: NativeSession,
  nativeSessionId: string,
): NativeSession {
  return session.bindingState === "deferred"
    ? session
    : { ...session, nativeSessionId };
}

function encodeSession(transportId: string, nativeSessionId: string): string {
  return `${SESSION_PREFIX}${transportId}:${Buffer.from(nativeSessionId).toString("base64url")}`;
}

function decodeSession(value: string): DecodedBinding | undefined {
  if (!value.startsWith(SESSION_PREFIX)) return undefined;
  const binding = value.slice(SESSION_PREFIX.length);
  const separator = binding.indexOf(":");
  if (separator <= 0 || separator === binding.length - 1) {
    throw new Error("Invalid Okami transport session binding");
  }
  const transportId = binding.slice(0, separator);
  const nativeSessionId = Buffer.from(
    binding.slice(separator + 1),
    "base64url",
  ).toString("utf8");
  if (!nativeSessionId) throw new Error("Empty native session binding");
  return { transportId, nativeSessionId };
}

async function safeDetect(adapter: RuntimeAdapter): Promise<RuntimeHealth> {
  try {
    return await adapter.detect();
  } catch (error) {
    return {
      available: false,
      protocolSupported: false,
      version: null,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
