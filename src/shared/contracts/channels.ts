// Channel names only — no zod, no runtime dependencies. The sandboxed preload
// imports this module and must stay dependency-free.
export const ipcChannels = [
  "system:doctor",
  "models:list",
  "task:create",
  "task:rename",
  "task:delete",
  "workspace:pick",
  "file:pick",
  "fs:list",
  "fs:read",
  "terminal:open",
  "terminal:write",
  "terminal:resize",
  "terminal:close",
  "run:list",
  "lane:setPermissionMode",
  "task:archive",
  "task:fork",
  "conversation:export",
  "task:list",
  "lane:list",
  "conversation:history",
  "lane:ensure",
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

export const terminalDataChannel = "terminal:data";
