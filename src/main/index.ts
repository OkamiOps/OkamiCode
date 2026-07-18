import { app, BrowserWindow } from "electron";
import path from "node:path";
import { secureWebPreferences } from "./window";

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      ...secureWebPreferences,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }
  return window;
}

app.whenReady().then(() => {
  createMainWindow();
});
app.on("window-all-closed", () => app.quit());
