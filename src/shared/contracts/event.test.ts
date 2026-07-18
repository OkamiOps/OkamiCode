import fixture from "../../../tests/fixtures/contracts/canonical-event-v1.json";
import { describe, expect, it } from "vitest";
import { canonicalEventSchema } from "./event";

describe("canonicalEventSchema", () => {
  it("accepts the frozen v1 fixture", () => {
    const event = canonicalEventSchema.parse(fixture);
    expect(event.schemaVersion).toBe(1);
    expect(event.kind).toBe("tool_call_completed");
  });
  it("rejects an unknown kind", () => {
    expect(() =>
      canonicalEventSchema.parse({ ...fixture, kind: "mystery" }),
    ).toThrow();
  });
});
