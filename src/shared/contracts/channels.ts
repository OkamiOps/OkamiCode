// Channel names only — no zod, no runtime dependencies. The sandboxed preload
// imports this module and must stay dependency-free.
export const ipcChannels = [
  "system:doctor",
  "task:create",
  "task:list",
  "lane:list",
  "lane:open",
  "lane:sendTurn",
  "run:cancel",
  "approval:resolve",
  "quickChat:create",
  "quickChat:send",
  "usage:overview",
  "usage:refresh",
  "usage:alertSet",
  "memory:configure",
  "memory:search",
  "memory:reindex",
] as const;

export type IpcChannel = (typeof ipcChannels)[number];

export const eventChannel = "workbench:event";
