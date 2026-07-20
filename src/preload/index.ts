import { contextBridge, ipcRenderer } from "electron";
import {
  eventChannel,
  ipcChannels,
  terminalDataChannel,
} from "../shared/contracts/channels";
import type { IpcInvokeFacade, OkamiBridge } from "../shared/contracts/ipc";

const invoke = Object.freeze(
  Object.fromEntries(
    ipcChannels.map((channel) => [
      channel,
      (payload: unknown) => ipcRenderer.invoke(channel, payload),
    ]),
  ) as IpcInvokeFacade,
);

const okami = Object.freeze({
  bridgeVersion: 1,
  invoke,
  onEvent: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, data: unknown) => listener(data);
    ipcRenderer.on(eventChannel, wrapped);
    return () => ipcRenderer.removeListener(eventChannel, wrapped);
  },
  onTerminalData: (listener: (chunk: unknown) => void) => {
    const wrapped = (_event: unknown, data: unknown) => listener(data);
    ipcRenderer.on(terminalDataChannel, wrapped);
    return () => ipcRenderer.removeListener(terminalDataChannel, wrapped);
  },
} satisfies OkamiBridge);

contextBridge.exposeInMainWorld("okami", okami);
