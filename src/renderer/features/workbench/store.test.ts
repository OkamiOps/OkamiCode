import { expect, it } from "vitest";
import type { CanonicalEvent } from "../../../shared/contracts/event";
import type { WorkbenchLane } from "./api";
import { createWorkbenchStore } from "./store";

const taskId = "27ee79a7-d3c3-48dd-84c6-cb589a4cb606";
const laneId = "50df72f3-cc11-42d2-87be-c928a9ae2cbf";
const runId = "4d32d86d-3199-4327-9d0c-e283268ed239";

const mimoLane = {
  laneId,
  taskId,
  harness: "native",
  runtimeKind: "mimo",
  runtimeVersion: "responses-v1",
  providerAccountLabel: "MiMo",
  model: "mimo-v2.5",
  routeKind: "native",
  routeReason: "native_requested",
  displayQuotaAccount: "MiMo Token Plan",
  permissionMode: "manual",
  workspacePath: "/workspace/okami",
  nativeSessionIdPrefix: "okami:v1:mimo-token-plan",
  status: "ready",
  temperature: "hot",
  pendingDeltaEvents: 0,
} satisfies WorkbenchLane;

it("freezes provider and model identity when the response stream is created", () => {
  const store = createWorkbenchStore();
  store.getState().upsertLane(mimoLane);
  const event = {
    schemaVersion: 1,
    id: "event-mimo-answer",
    taskId,
    laneId,
    runId,
    sequence: 1,
    occurredAt: "2026-07-24T12:00:00.000Z",
    kind: "message_completed",
    nativeEventId: "answer",
    payload: { text: "Resposta produzida pelo MiMo" },
  } satisfies CanonicalEvent;

  store.getState().applyEvent(event);

  expect(store.getState().streams[`${runId}:answer`]).toMatchObject({
    laneId,
    runtimeKind: "mimo",
    providerAccountLabel: "MiMo",
    model: "mimo-v2.5",
  });
});
