import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../db/test-support";
import type { AuditEntry } from "../db/repositories/audit";
import { exportAuditEntries, type AuditExportWriter } from "./export";

describe("exportAuditEntries", () => {
  it("serializes redacted audit rows as deterministic append-only JSONL", async () => {
    const entries: AuditEntry[] = [
      {
        id: "entry-b",
        taskId: null,
        laneId: null,
        runId: null,
        actor: "user",
        action: "authorize",
        decision: "allow_once",
        capability: "audit.export",
        resource: { path: "/private/audit.jsonl", token: "sk-secret" },
        metadata: { z: "last", a: "first", authorization: "Bearer secret" },
        occurredAt: "2026-07-21T09:00:00.000Z",
      },
      {
        id: "entry-a",
        taskId: "task-1",
        laneId: "lane-1",
        runId: "run-1",
        actor: "system",
        action: "run_interrupted",
        decision: null,
        capability: null,
        resource: null,
        metadata: {},
        occurredAt: "2026-07-21T09:00:00.000Z",
      },
    ];
    const appended: Array<{ path: string; contents: string }> = [];
    const writer: AuditExportWriter = {
      append(path, contents) {
        appended.push({ path, contents });
      },
    };

    const result = await exportAuditEntries(entries, {
      path: "/exports/audit.jsonl",
      writer,
      redaction: { filesystemPaths: ["/private/audit.jsonl"] },
    });

    expect(appended).toEqual([
      {
        path: "/exports/audit.jsonl",
        contents:
          '{"action":"run_interrupted","actor":"system","capability":null,"decision":null,"id":"entry-a","laneId":"lane-1","metadata":{},"occurredAt":"2026-07-21T09:00:00.000Z","resource":null,"runId":"run-1","taskId":"task-1"}\n' +
          '{"action":"authorize","actor":"user","capability":"audit.export","decision":"allow_once","id":"entry-b","laneId":null,"metadata":{"a":"first","authorization":"[REDACTED]","z":"last"},"occurredAt":"2026-07-21T09:00:00.000Z","resource":{"path":"[REDACTED]","token":"[REDACTED]"},"runId":null,"taskId":null}\n',
      },
    ]);
    expect(result).toEqual({ entryCount: 2 });
    expect(JSON.stringify(entries)).toContain("sk-secret");
    expect(appended[0]?.contents).not.toContain("sk-secret");
    expect(appended[0]?.contents).toContain("allow_once");
  });

  it("reads audit rows in stable time and id order", () => {
    const fixture = createTestDatabase();
    fixture.audit.record({
      id: "entry-b",
      taskId: null,
      laneId: null,
      runId: null,
      actor: "system",
      action: "second",
      decision: null,
      capability: null,
      resource: { resource: "two" },
      metadata: { b: 2 },
      occurredAt: "2026-07-21T09:00:00.000Z",
    });
    fixture.audit.record({
      id: "entry-a",
      taskId: null,
      laneId: null,
      runId: null,
      actor: "system",
      action: "first",
      decision: null,
      capability: null,
      resource: { resource: "one" },
      metadata: { a: 1 },
      occurredAt: "2026-07-21T09:00:00.000Z",
    });

    expect(fixture.audit.list()).toMatchObject([
      { id: "entry-a", resource: { resource: "one" }, metadata: { a: 1 } },
      { id: "entry-b", resource: { resource: "two" }, metadata: { b: 2 } },
    ]);
  });
});
