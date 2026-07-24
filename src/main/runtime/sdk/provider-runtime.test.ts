import { describe, expect, it, vi } from "vitest";
import type { LaneId, RunId } from "../../../shared/ids";
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
import {
  ProviderRuntimeAdapter,
  type RuntimeTransportCandidate,
} from "./provider-runtime";

const laneId = "11111111-1111-4111-8111-111111111111" as LaneId;
const runId = "22222222-2222-4222-8222-222222222222" as RunId;

describe("ProviderRuntimeAdapter", () => {
  it("uses the highest-priority healthy transport and preserves its binding", async () => {
    const api = new FakeTransport("grok", healthy("api-1"));
    const cli = new FakeTransport("grok", healthy("cli-1"));
    const runtime = provider([
      candidate("xai-api", "api", 10, api),
      candidate("grok-cli", "cli", 100, cli),
    ]);

    const session = await runtime.start(startRequest());
    await runtime.sendTurn({
      runId,
      laneId,
      nativeSessionId: session.nativeSessionId,
      input: "continue",
    });

    expect(api.startRequests).toHaveLength(1);
    expect(cli.startRequests).toHaveLength(0);
    expect(session.nativeSessionId).toMatch(/^okami:v1:xai-api:/u);
    expect(api.turnRequests[0]?.nativeSessionId).toBe("api-native-session");
  });

  it("falls back without making the provider depend on its CLI", async () => {
    const api = new FakeTransport("grok", unavailable("missing key"));
    const cli = new FakeTransport("grok", healthy("cli-1"));
    const runtime = provider([
      candidate("xai-api", "api", 10, api),
      candidate("grok-cli", "cli", 100, cli),
    ]);

    const health = await runtime.detect();
    const session = await runtime.start(startRequest());

    expect(health).toMatchObject({
      available: true,
      protocolSupported: true,
      transportId: "grok-cli",
    });
    expect(session.nativeSessionId).toMatch(/^okami:v1:grok-cli:/u);
  });

  it("remains healthy when the optional CLI is missing but API is configured", async () => {
    const runtime = provider([
      candidate(
        "xai-api",
        "api",
        10,
        new FakeTransport("grok", healthy("api-1")),
      ),
      candidate(
        "grok-cli",
        "cli",
        100,
        new FakeTransport("grok", unavailable("ENOENT")),
      ),
    ]);

    await expect(runtime.detect()).resolves.toMatchObject({
      available: true,
      transportId: "xai-api",
      transportKind: "api",
    });
  });

  it("routes cancellation and approvals to the transport owning the run", async () => {
    const api = new FakeTransport("grok", healthy("api-1"));
    const cli = new FakeTransport("grok", healthy("cli-1"));
    const runtime = provider([
      candidate("xai-api", "api", 10, api),
      candidate("grok-cli", "cli", 100, cli),
    ]);
    const session = await runtime.start(startRequest());
    await runtime.sendTurn({
      runId,
      laneId,
      nativeSessionId: session.nativeSessionId,
      input: "continue",
    });
    const approval: ApprovalResponse = {
      runId,
      approvalId: "approval-1",
      decision: "allow_once",
    };

    await runtime.respondToApproval(approval);
    await runtime.cancel(runId);

    expect(api.respondToApproval).toHaveBeenCalledWith(approval);
    expect(api.cancel).toHaveBeenCalledWith(runId);
    expect(cli.respondToApproval).not.toHaveBeenCalled();
    expect(cli.cancel).not.toHaveBeenCalled();
  });

  it("resumes legacy sessions without rewriting their persisted identifier", async () => {
    const api = new FakeTransport("grok", healthy("api-1"));
    const cli = new FakeTransport("grok", healthy("cli-1"));
    const runtime = provider([
      candidate("xai-api", "api", 10, api),
      candidate("grok-cli", "cli", 100, cli, true),
    ]);

    const resumed = await runtime.resume({
      ...startRequest(),
      nativeSessionId: "old-cli-session",
    });

    expect(cli.resumeRequests[0]?.nativeSessionId).toBe("old-cli-session");
    expect(resumed.nativeSessionId).toBe("old-cli-session");
  });

  it("migrates a binding from a removed CLI transport to the current legacy owner", async () => {
    const tokenPlan = new FakeTransport("grok", healthy("token-plan-v1"));
    const runtime = provider([
      candidate("mimo-token-plan", "api", 10, tokenPlan, true),
    ]);
    const removedBinding = `okami:v1:mimo-cli:${Buffer.from(
      "persisted-cli-session",
    ).toString("base64url")}`;

    const resumed = await runtime.resume({
      ...startRequest(),
      nativeSessionId: removedBinding,
    });
    await runtime.sendTurn({
      runId,
      laneId,
      nativeSessionId: resumed.nativeSessionId,
      input: "continue after migration",
    });

    expect(tokenPlan.resumeRequests[0]?.nativeSessionId).toBe(
      "persisted-cli-session",
    );
    expect(resumed.nativeSessionId).toBe(
      `okami:v1:mimo-token-plan:${Buffer.from("persisted-cli-session").toString(
        "base64url",
      )}`,
    );
    expect(tokenPlan.turnRequests[0]?.nativeSessionId).toBe(
      "persisted-cli-session",
    );
  });

  it("keeps an existing encoded transport binding strict", async () => {
    const api = new FakeTransport("grok", healthy("api-1"));
    const cli = new FakeTransport("grok", unavailable("removed executable"));
    const runtime = provider([
      candidate("xai-api", "api", 10, api, true),
      candidate("grok-cli", "cli", 100, cli),
    ]);
    const cliBinding = `okami:v1:grok-cli:${Buffer.from(
      "existing-cli-session",
    ).toString("base64url")}`;

    await runtime.resume({
      ...startRequest(),
      nativeSessionId: cliBinding,
    });

    expect(cli.resumeRequests[0]?.nativeSessionId).toBe("existing-cli-session");
    expect(api.resumeRequests).toHaveLength(0);
  });

  it("continues to reject malformed encoded transport bindings", async () => {
    const runtime = provider([
      candidate(
        "mimo-token-plan",
        "api",
        10,
        new FakeTransport("grok", healthy("token-plan-v1")),
        true,
      ),
    ]);

    await expect(
      runtime.resume({
        ...startRequest(),
        nativeSessionId: "okami:v1:mimo-cli:",
      }),
    ).rejects.toThrow("Invalid Okami transport session binding");
  });
});

function provider(
  candidates: RuntimeTransportCandidate[],
): ProviderRuntimeAdapter {
  return new ProviderRuntimeAdapter("grok", candidates);
}

function candidate(
  id: string,
  kind: "api" | "cli",
  priority: number,
  adapter: RuntimeAdapter,
  legacySessionOwner = false,
): RuntimeTransportCandidate {
  return {
    descriptor: {
      id,
      kind,
      authentication: kind === "api" ? "api_key" : "external_cli",
      entitlement: kind === "api" ? "token_plan" : "subscription",
      priority,
      optional: true,
      protocolVersion: kind === "api" ? "responses-v1" : "stream-json",
      executable: kind === "api" ? null : "fake-cli",
      legacySessionOwner,
    },
    adapter,
  };
}

function startRequest(): StartSessionRequest {
  return { laneId, cwd: "/workspace", model: "grok-test" };
}

function healthy(version: string): RuntimeHealth {
  return { available: true, protocolSupported: true, version };
}

function unavailable(detail: string): RuntimeHealth {
  return {
    available: false,
    protocolSupported: false,
    version: null,
    detail,
  };
}

class FakeTransport implements RuntimeAdapter {
  readonly startRequests: StartSessionRequest[] = [];
  readonly resumeRequests: ResumeSessionRequest[] = [];
  readonly turnRequests: NativeTurnRequest[] = [];
  readonly respondToApproval = vi.fn(async () => undefined);
  readonly cancel = vi.fn(async () => undefined);

  constructor(
    readonly kind: "grok",
    private readonly health: RuntimeHealth,
  ) {}

  detect(): Promise<RuntimeHealth> {
    return Promise.resolve(this.health);
  }

  start(request: StartSessionRequest): Promise<NativeSession> {
    this.startRequests.push(request);
    return Promise.resolve({
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId:
        this.health.version === "api-1"
          ? "api-native-session"
          : "cli-native-session",
      runtimeVersion: this.health.version ?? "unknown",
    });
  }

  resume(request: ResumeSessionRequest): Promise<NativeSession> {
    this.resumeRequests.push(request);
    return Promise.resolve({
      laneId: request.laneId,
      bindingState: "authoritative",
      nativeSessionId: request.nativeSessionId,
      runtimeVersion: this.health.version ?? "unknown",
    });
  }

  sendTurn(request: NativeTurnRequest): Promise<RunHandle> {
    this.turnRequests.push(request);
    return Promise.resolve({
      runId: request.runId,
      events: emptyEvents(),
    });
  }

  usageCapabilities(): UsageCapabilities {
    return {
      quotaSnapshot: false,
      contextSnapshot: false,
      activitySnapshot: false,
    };
  }
}

async function* emptyEvents() {
  // The router must not need to consume the stream to preserve run ownership.
}
