import { contextBridge } from "electron";

// The full typed API arrives in Task 10; expose only a version marker until then.
contextBridge.exposeInMainWorld("okami", { bridgeVersion: 1 });
