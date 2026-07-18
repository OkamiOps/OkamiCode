import { ipcChannels, type IpcChannel } from "../../shared/contracts/ipc";
import { type RendererOkamiBridge } from "../lib/ipc/client";

interface OkamiMockResponses extends Partial<Record<IpcChannel, unknown>> {
  systemDoctor?: unknown;
}

let eventListener: ((event: unknown) => void) | undefined;

export function installOkamiMock(responses: OkamiMockResponses): void {
  const invoke = Object.fromEntries(
    ipcChannels.map((channel) => [
      channel,
      async () =>
        channel === "system:doctor"
          ? (responses["system:doctor"] ?? responses.systemDoctor)
          : responses[channel],
    ]),
  ) as unknown as RendererOkamiBridge["invoke"];
  Object.defineProperty(window, "okami", {
    configurable: true,
    value: Object.freeze({
      bridgeVersion: 1,
      invoke: Object.freeze(invoke),
      onEvent: (listener) => {
        eventListener = listener;
        return () => {
          if (eventListener === listener) eventListener = undefined;
        };
      },
    } satisfies RendererOkamiBridge),
  });
}

export function emitOkamiEvent(event: unknown): void {
  eventListener?.(event);
}
