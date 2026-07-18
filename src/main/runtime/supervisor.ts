import type { RunId } from "../../shared/ids";
import {
  JsonlProcess,
  type JsonlProcessOptions,
  type ProcessWaitResult,
} from "./transport";

interface OwnedRun {
  pid: number;
  process: JsonlProcess;
}

export class RuntimeSupervisor {
  private readonly ownedRuns = new Map<RunId, OwnedRun>();

  async spawn(
    runId: RunId,
    command: string,
    args: string[],
    options?: JsonlProcessOptions,
  ): Promise<JsonlProcess> {
    const current = this.ownedRuns.get(runId);
    if (current?.process.isRunning) {
      throw new Error(`Run ${runId} already owns a live process`);
    }

    const process = await JsonlProcess.spawn(command, args, options);
    const owned = { pid: process.pid, process };
    this.ownedRuns.set(runId, owned);
    void process.wait().then(() => this.removeIfCurrent(runId, owned));
    return process;
  }

  liveOwnedRunIds(): RunId[] {
    return [...this.ownedRuns.entries()]
      .filter(
        ([, owned]) =>
          owned.process.isRunning && owned.process.pid === owned.pid,
      )
      .map(([runId]) => runId);
  }

  async cancel(runId: RunId): Promise<ProcessWaitResult | undefined> {
    const owned = this.ownedRuns.get(runId);
    if (!owned) return undefined;
    await owned.process.cancel();
    const result = await owned.process.wait();
    this.removeIfCurrent(runId, owned);
    return result;
  }

  private removeIfCurrent(runId: RunId, owned: OwnedRun): void {
    if (this.ownedRuns.get(runId) === owned) this.ownedRuns.delete(runId);
  }
}
