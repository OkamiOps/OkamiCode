export const secureWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  // The workspace panel embeds a preview browser via <webview>. The guest
  // pages stay sandboxed (no node, isolated session partition set in the
  // renderer tag); only the tag itself is enabled here.
  webviewTag: true,
} as const;

type WindowOpenHandler = (details: { url: string }) => {
  action: "allow" | "deny";
};

interface ExternalNavigationWebContents {
  setWindowOpenHandler(handler: WindowOpenHandler): void;
}

export function configureExternalNavigation(
  webContents: ExternalNavigationWebContents,
  openExternal: (url: string) => Promise<unknown>,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedWebUrl(url)) {
      void openExternal(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
}

function isTrustedWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
