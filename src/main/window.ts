export const secureWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // The workspace panel embeds a preview browser via <webview>. The guest
  // pages stay sandboxed (no node, isolated session partition set in the
  // renderer tag); only the tag itself is enabled here.
  webviewTag: true,
} as const;
