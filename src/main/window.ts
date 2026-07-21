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

type NativeEditRole =
  | "appMenu"
  | "windowMenu"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "selectAll";

interface NativeMenuItem {
  label?: string;
  role?: NativeEditRole;
  type?: "separator";
  enabled?: boolean;
  submenu?: NativeMenuItem[];
  click?: () => void;
}

interface NativeMenu {
  popup(): void;
}

interface NativeEditingWebContents {
  on(
    event: "context-menu",
    handler: (
      event: { preventDefault(): void },
      params: NativeContextMenuParams,
    ) => void,
  ): void;
}

interface NativeContextMenuParams {
  linkURL?: string;
  selectionText?: string;
  isEditable?: boolean;
  editFlags?: Partial<
    Record<
      | "canUndo"
      | "canRedo"
      | "canCut"
      | "canCopy"
      | "canPaste"
      | "canSelectAll",
      boolean
    >
  >;
}

interface NativeEditingOptions {
  webContents: NativeEditingWebContents;
  menu: {
    buildFromTemplate(template: NativeMenuItem[]): NativeMenu;
    setApplicationMenu(menu: NativeMenu): void;
  };
  clipboard: { writeText(text: string): void };
  openExternal(url: string): Promise<unknown>;
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

export function configureNativeEditing({
  webContents,
  menu,
  clipboard,
  openExternal,
}: NativeEditingOptions): void {
  menu.setApplicationMenu(
    menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Editar",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { type: "separator" },
          { role: "selectAll" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );

  webContents.on("context-menu", (event, params) => {
    const template = contextMenuTemplate(params, clipboard, openExternal);
    if (template.length === 0) return;
    event.preventDefault();
    menu.buildFromTemplate(template).popup();
  });
}

function contextMenuTemplate(
  params: NativeContextMenuParams,
  clipboard: NativeEditingOptions["clipboard"],
  openExternal: NativeEditingOptions["openExternal"],
): NativeMenuItem[] {
  const template: NativeMenuItem[] = [];
  const link = params.linkURL?.trim() ?? "";
  if (isTrustedWebUrl(link)) {
    template.push(
      {
        label: "Abrir link no navegador",
        click: () => void openExternal(link).catch(() => undefined),
      },
      { label: "Copiar link", click: () => clipboard.writeText(link) },
    );
  }

  if (params.isEditable) {
    if (template.length > 0) template.push({ type: "separator" });
    const flags = params.editFlags ?? {};
    template.push(
      { role: "undo", enabled: flags.canUndo !== false },
      { role: "redo", enabled: flags.canRedo !== false },
      { type: "separator" },
      { role: "cut", enabled: flags.canCut !== false },
      { role: "copy", enabled: flags.canCopy !== false },
      { role: "paste", enabled: flags.canPaste !== false },
      { type: "separator" },
      { role: "selectAll", enabled: flags.canSelectAll !== false },
    );
  } else if ((params.selectionText?.trim().length ?? 0) > 0) {
    if (template.length > 0) template.push({ type: "separator" });
    template.push({ role: "copy" });
  }

  return template;
}

function isTrustedWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
