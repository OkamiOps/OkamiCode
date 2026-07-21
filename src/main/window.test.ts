import { describe, expect, it, vi } from "vitest";
import {
  configureExternalNavigation,
  configureNativeEditing,
  secureWebPreferences,
} from "./window";

describe("main window", () => {
  it("enforces the renderer security invariants", () => {
    expect(secureWebPreferences.contextIsolation).toBe(true);
    expect(secureWebPreferences.nodeIntegration).toBe(false);
    expect(secureWebPreferences.sandbox).toBe(true);
  });

  it("opens only trusted web links in the system browser and denies child windows", async () => {
    let handler:
      ((details: { url: string }) => { action: "deny" | "allow" }) | undefined;
    const openExternal = vi.fn().mockResolvedValue(undefined);

    configureExternalNavigation(
      {
        setWindowOpenHandler: (next) => {
          handler = next;
        },
      },
      openExternal,
    );

    expect(handler?.({ url: "https://meet.google.com/abc-defg-hij" })).toEqual({
      action: "deny",
    });
    await vi.waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith(
        "https://meet.google.com/abc-defg-hij",
      ),
    );

    expect(handler?.({ url: "javascript:alert(1)" })).toEqual({
      action: "deny",
    });
    expect(handler?.({ url: "file:///Users/marcos/.ssh/id_rsa" })).toEqual({
      action: "deny",
    });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("installs native edit shortcuts and a contextual menu for text and links", async () => {
    let contextMenuHandler:
      | ((
          event: { preventDefault(): void },
          params: Record<string, unknown>,
        ) => void)
      | undefined;
    const popup = vi.fn();
    const templates: Array<Array<Record<string, unknown>>> = [];
    const buildFromTemplate = vi.fn((template) => {
      templates.push(template as Array<Record<string, unknown>>);
      return { popup };
    });
    const setApplicationMenu = vi.fn();
    const writeText = vi.fn();
    const openExternal = vi.fn().mockResolvedValue(undefined);

    configureNativeEditing({
      webContents: {
        on: (_event, handler) => {
          contextMenuHandler = handler;
        },
      },
      menu: { buildFromTemplate, setApplicationMenu },
      clipboard: { writeText },
      openExternal,
    });

    const editMenu = templates[0]?.find((item) => item.label === "Editar");
    expect(editMenu?.submenu).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "undo" }),
        expect.objectContaining({ role: "redo" }),
        expect.objectContaining({ role: "cut" }),
        expect.objectContaining({ role: "copy" }),
        expect.objectContaining({ role: "paste" }),
        expect.objectContaining({ role: "selectAll" }),
      ]),
    );
    expect(setApplicationMenu).toHaveBeenCalledOnce();

    contextMenuHandler?.(
      { preventDefault: vi.fn() },
      {
        linkURL: "https://meet.google.com/abc-defg-hij",
        selectionText: "Trecho selecionado",
        isEditable: true,
        editFlags: {
          canUndo: true,
          canRedo: true,
          canCut: true,
          canCopy: true,
          canPaste: true,
          canSelectAll: true,
        },
      },
    );

    const contextTemplate = templates[1] ?? [];
    expect(contextTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Abrir link no navegador" }),
        expect.objectContaining({ label: "Copiar link" }),
        expect.objectContaining({ role: "copy" }),
        expect.objectContaining({ role: "paste" }),
      ]),
    );
    expect(popup).toHaveBeenCalledOnce();

    const copyLink = contextTemplate.find(
      (item) => item.label === "Copiar link",
    );
    (copyLink?.click as (() => void) | undefined)?.();
    expect(writeText).toHaveBeenCalledWith(
      "https://meet.google.com/abc-defg-hij",
    );

    const openLink = contextTemplate.find(
      (item) => item.label === "Abrir link no navegador",
    );
    (openLink?.click as (() => void) | undefined)?.();
    await vi.waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith(
        "https://meet.google.com/abc-defg-hij",
      ),
    );
  });
});
