import { describe, expect, it } from "vitest";
import { createTestDatabase, sequenceEvent } from "../test-support";

describe("EventRepository", () => {
  it("is append-only, idempotent, and cursor-ordered", () => {
    const fx = createTestDatabase();
    const first = fx.event(sequenceEvent(1, "native-1"));
    expect(fx.events.append(first).inserted).toBe(true);
    expect(fx.events.append(first).inserted).toBe(false);
    fx.events.append(fx.event(sequenceEvent(2, "native-2")));
    const delta = fx.events.afterCursor(first.laneId, 1);
    expect(delta.map((e) => e.sequence)).toEqual([2]);
  });
});
