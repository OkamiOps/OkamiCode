import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../test-support";

describe("LaneRepository native session binding", () => {
  it("inserts once, refreshes an equal binding, and rejects a conflicting id", () => {
    const fixture = createTestDatabase();
    const first = {
      laneId: fixture.laneId,
      nativeSessionId: "native-session-1",
      runtimeVersion: "runtime-1",
      boundAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z",
    };

    fixture.lanes.bindNativeSessionIfAbsentOrEqual(first);
    fixture.lanes.bindNativeSessionIfAbsentOrEqual({
      ...first,
      runtimeVersion: "runtime-2",
      updatedAt: "2026-07-21T12:01:00.000Z",
      rehydrationRequired: false,
    });

    expect(fixture.lanes.findNativeSessionBinding(fixture.laneId)).toEqual({
      ...first,
      runtimeVersion: "runtime-2",
      updatedAt: "2026-07-21T12:01:00.000Z",
      rehydrationRequired: false,
    });
    expect(() =>
      fixture.lanes.bindNativeSessionIfAbsentOrEqual({
        ...first,
        nativeSessionId: "different-native-session",
      }),
    ).toThrow("Native session binding conflict");
    expect(fixture.lanes.findNativeSessionBinding(fixture.laneId)).toEqual({
      ...first,
      runtimeVersion: "runtime-2",
      updatedAt: "2026-07-21T12:01:00.000Z",
      rehydrationRequired: false,
    });
    fixture.db.close();
  });

  it("atomically migrates only the exact provider-scoped retired binding", () => {
    const fixture = createTestDatabase();
    const fromNativeSessionId = `okami:v1:mimo-cli:${Buffer.from(
      "legacy-session",
    ).toString("base64url")}`;
    const toNativeSessionId = `okami:v1:mimo-token-plan:${Buffer.from(
      "new-session",
    ).toString("base64url")}`;
    fixture.lanes.bindNativeSession({
      laneId: fixture.laneId,
      nativeSessionId: fromNativeSessionId,
      runtimeVersion: "mimo-cli-v1",
      boundAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:00:00.000Z",
    });

    fixture.lanes.compareAndMigrateNativeSession({
      laneId: fixture.laneId,
      runtimeKind: "mimo",
      fromNativeSessionId,
      toNativeSessionId,
      runtimeVersion: "responses-v1",
      updatedAt: "2026-07-24T12:00:00.000Z",
    });

    expect(fixture.lanes.findNativeSessionBinding(fixture.laneId)).toEqual({
      laneId: fixture.laneId,
      nativeSessionId: toNativeSessionId,
      runtimeVersion: "responses-v1",
      boundAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
      migrationFromNativeSessionId: fromNativeSessionId,
      rehydrationRequired: true,
    });
    expect(() =>
      fixture.lanes.compareAndMigrateNativeSession({
        laneId: fixture.laneId,
        runtimeKind: "mimo",
        fromNativeSessionId,
        toNativeSessionId: `${toNativeSessionId}-again`,
        runtimeVersion: "responses-v1",
        updatedAt: "2026-07-24T12:01:00.000Z",
      }),
    ).toThrow("Native session migration conflict");
    expect(() =>
      fixture.lanes.compareAndMigrateNativeSession({
        laneId: fixture.laneId,
        runtimeKind: "minimax",
        fromNativeSessionId: `okami:v1:mimo-cli:${Buffer.from("other").toString(
          "base64url",
        )}`,
        toNativeSessionId,
        runtimeVersion: "chat-completions-v1",
        updatedAt: "2026-07-24T12:02:00.000Z",
      }),
    ).toThrow("not a retired minimax transport binding");
    fixture.db.close();
  });

  it("migrates a missing provider session within the same current transport", () => {
    const fixture = createTestDatabase();
    const fromNativeSessionId = `okami:v1:codex-managed:${Buffer.from(
      "missing-thread",
    ).toString("base64url")}`;
    const toNativeSessionId = `okami:v1:codex-managed:${Buffer.from(
      "replacement-thread",
    ).toString("base64url")}`;
    fixture.lanes.bindNativeSession({
      laneId: fixture.laneId,
      nativeSessionId: fromNativeSessionId,
      runtimeVersion: "0.145.0",
      boundAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
    });

    fixture.lanes.compareAndMigrateNativeSession({
      laneId: fixture.laneId,
      runtimeKind: "codex",
      fromNativeSessionId,
      toNativeSessionId,
      runtimeVersion: "0.145.0",
      updatedAt: "2026-07-24T12:01:00.000Z",
    });

    expect(
      fixture.lanes.findNativeSessionBinding(fixture.laneId),
    ).toMatchObject({
      nativeSessionId: toNativeSessionId,
      migrationFromNativeSessionId: fromNativeSessionId,
      rehydrationRequired: true,
    });
    fixture.db.close();
  });

  it("marks continuation rehydration only for the exact current binding", () => {
    const fixture = createTestDatabase();
    fixture.lanes.bindNativeSession({
      laneId: fixture.laneId,
      nativeSessionId: "current-token-plan-session",
      runtimeVersion: "responses-v1",
      boundAt: "2026-07-24T12:00:00.000Z",
      updatedAt: "2026-07-24T12:00:00.000Z",
    });

    expect(() =>
      fixture.lanes.markNativeSessionRehydrationRequired(
        fixture.laneId,
        "stale-token-plan-session",
        "2026-07-24T12:01:00.000Z",
      ),
    ).toThrow("Native session rehydration conflict");
    fixture.lanes.markNativeSessionRehydrationRequired(
      fixture.laneId,
      "current-token-plan-session",
      "2026-07-24T12:02:00.000Z",
    );

    expect(
      fixture.lanes.findNativeSessionBinding(fixture.laneId),
    ).toMatchObject({
      nativeSessionId: "current-token-plan-session",
      rehydrationRequired: true,
      updatedAt: "2026-07-24T12:02:00.000Z",
    });
    fixture.db.close();
  });
});
