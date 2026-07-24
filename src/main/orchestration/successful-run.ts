import type { CanonicalEvent } from "../../shared/contracts/event";
import type { RunHandle } from "../runtime/adapter";

export function afterSuccessfulRunCompletion(
  run: RunHandle,
  laneId: string,
  onCompleted: () => void,
): RunHandle {
  return {
    ...run,
    events: completionAwareEvents(run, laneId, onCompleted),
  };
}

async function* completionAwareEvents(
  run: RunHandle,
  laneId: string,
  onCompleted: () => void,
): AsyncGenerator<CanonicalEvent> {
  let matchingTerminal:
    "run_completed" | "run_failed" | "run_cancelled" | undefined;
  for await (const event of run.events) {
    if (
      event.runId === run.runId &&
      event.laneId === laneId &&
      (event.kind === "run_completed" ||
        event.kind === "run_failed" ||
        event.kind === "run_cancelled")
    ) {
      matchingTerminal = event.kind;
    }
    yield event;
  }
  if (matchingTerminal === "run_completed") onCompleted();
}
