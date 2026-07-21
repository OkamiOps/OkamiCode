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
    });

    expect(fixture.lanes.findNativeSessionBinding(fixture.laneId)).toEqual({
      ...first,
      runtimeVersion: "runtime-2",
      updatedAt: "2026-07-21T12:01:00.000Z",
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
    });
    fixture.db.close();
  });
});
