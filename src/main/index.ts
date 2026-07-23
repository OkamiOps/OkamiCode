import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} from "electron";
import { ConnectorCredentialVault } from "./connectors/credential-vault";
import {
  GoogleOAuthAuthorizer,
  RefreshingCredentialVault,
} from "./connectors/google-oauth";
import { openDatabase } from "./db/connection";
import { createAppState, type AppState } from "./ipc/app-state";
import { registerIpcHandlers } from "./ipc/handlers";
import { createChatGptBridge } from "./gateway/bridges/chatgpt";
import { createCodexChatGptBackend } from "./gateway/bridges/chatgpt-backend";
import { createGatewayProfile } from "./gateway/profile";
import { startGatewayServer } from "./gateway/server";
import { LeaseRepository, type CapabilityLease } from "./policy/lease";
import { RepositoryApprovalBroker } from "./runtime/codex/adapter";
import { createModelCatalogService } from "./runtime/model-catalog";
import { ModelFavoritesService } from "./runtime/model-favorites";
import { createRuntimeRegistry } from "./runtime/registry";
import { RuntimeSupervisor } from "./runtime/supervisor";
import { getOrCreateDatabaseKey } from "./secrets";
import { MemoryService } from "./memory/indexer";
import { StartupRecovery } from "./orchestration/recovery";
import { AuditRepository } from "./db/repositories/audit";
import {
  configureExternalNavigation,
  configureNativeEditing,
  secureWebPreferences,
} from "./window";
import { InboxApplicationService } from "./inbox/application-service";
import { ImapSyncAdapter } from "./inbox/imap-adapter";
import { ReplyDispatchService } from "./inbox/reply-dispatch-service";
import { CalendarService } from "./calendar/service";
import { CalendarApplicationService } from "./calendar/application-service";
import { GoogleCalendarAdapter } from "./calendar/google-adapter";
import { RemoteCalendarAdapter } from "./calendar/remote-adapter";
import type { Capability } from "./policy/action";
import type { TaskId } from "../shared/ids";
import { locateLocalBinary } from "./ecosystem/cli-capabilities";
import { resolveRuntimeCommands } from "./runtime/commands";
import { AgyCompanionServer } from "./runtime/agy/companion-server";
import { AgyPluginManager } from "./runtime/agy/plugin";
import { createAgyPolicyAuthorizer } from "./runtime/agy/policy-authorizer";
import { GoogleInboxOAuthService } from "./inbox/google-oauth-service";
import { InboxSyncScheduler } from "./inbox/sync-scheduler";
import { resolveAppStorageIdentity, resolveUserDataPath } from "./user-data";
import { bootstrapFailurePage } from "./bootstrap-failure";

const execFileAsync = promisify(execFile);

// safeStorage uses the application identity as part of its macOS Keychain
// lookup. Keep the original identity even though the visible product is now
// named OkamiCode, otherwise existing encrypted data becomes unreadable.
app.setName(resolveAppStorageIdentity());

// Keep the profile stable across the okami-workbench -> okami-code package
// rename. Visual/E2E overrides still take priority and stay isolated.
const userDataPath = resolveUserDataPath({
  appDataPath: app.getPath("appData"),
  currentUserDataPath: app.getPath("userData"),
  override: process.env.OKAMI_USER_DATA_DIR,
  pathExists: existsSync,
});
if (userDataPath !== app.getPath("userData")) {
  app.setPath("userData", userDataPath);
}

const GPT_BACKEND_MODEL = "gpt-5.6-sol";
const LEASED_CAPABILITIES: Capability[] = [
  "workspace.read",
  "workspace.write",
  "terminal.exec",
  "browser.open",
];
let memoryService: MemoryService | undefined;
let inboxSyncScheduler: InboxSyncScheduler | undefined;

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.js"),
      ...secureWebPreferences,
    },
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[okami] preload error", preloadPath, error);
  });
  configureExternalNavigation(window.webContents, (url) =>
    shell.openExternal(url),
  );
  configureNativeEditing({
    webContents: window.webContents,
    menu: {
      buildFromTemplate: (template) => Menu.buildFromTemplate(template),
      setApplicationMenu: (menu) =>
        Menu.setApplicationMenu(menu as unknown as Menu),
    },
    clipboard,
    openExternal: (url) => shell.openExternal(url),
  });
  window.webContents.on("did-finish-load", () => {
    void window.webContents
      .executeJavaScript("typeof window.okami")
      .then((bridge) => console.log("[okami] bridge:", bridge));
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }
  return window;
}

// Runs and leases are looked up lazily because adapters are constructed before
// the AppState that owns the repositories.
function runtimeDependencies(
  stateRef: () => AppState,
  leases: () => LeaseRepository,
) {
  const taskIdForRun = (runId: string): TaskId => {
    const run = stateRef().runs.findById(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    return run.taskId as TaskId;
  };
  const leaseIdsForRun = (runId: string) => {
    const state = stateRef();
    const run = state.runs.findById(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    const lane = state.lanes.findById(run.laneId);
    const workspace = lane?.workspacePath ?? homedir();
    const issued: Partial<Record<Capability, string>> = {};
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 60_000);
    for (const capability of LEASED_CAPABILITIES) {
      const lease: CapabilityLease = {
        id: randomUUID(),
        taskId: run.taskId,
        laneId: run.laneId,
        actor: { kind: "runtime", runtime: lane?.runtimeKind ?? "claude" },
        capability,
        // terminal.exec resources are command strings, not paths; workspace
        // confinement for them comes from the harness cwd/allowlist.
        resourcePattern:
          capability === "terminal.exec" || capability === "browser.open"
            ? "**"
            : `${workspace}/**`,
        budget: { maxUses: null, used: 0 },
        issuedAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        revokedAt: null,
      };
      leases().insert(lease);
      issued[capability] = lease.id;
    }
    return issued;
  };
  return { taskIdForRun, leaseIdsForRun };
}

function seedInitialWorkspace(state: AppState): void {
  const existing = state.database
    .prepare("SELECT count(*) AS count FROM tasks")
    .get() as { count: number };
  if (existing.count > 0) return;
  const workspace = path.join(homedir(), "OkamiWorkspace");
  mkdirSync(workspace, { recursive: true });
  const now = new Date().toISOString();
  const taskId = randomUUID();
  state.tasks.insert({
    id: taskId,
    kind: "workbench",
    title: "Primeira tarefa",
    objective: "Explorar o Okami Workbench",
    status: "open",
    workspacePath: workspace,
    createdAt: now,
    updatedAt: now,
  });
  const insertLane = (
    runtimeKind: "claude" | "codex",
    providerKind: "claude_max" | "chatgpt",
    model: string,
  ) =>
    state.lanes.insert({
      id: randomUUID(),
      taskId,
      runtimeKind,
      providerKind,
      model,
      status: "ready",
      workspacePath: workspace,
      lastEventCursor: 0,
      createdAt: now,
      updatedAt: now,
    });
  insertLane("claude", "claude_max", "opus");
  insertLane("codex", "chatgpt", GPT_BACKEND_MODEL);
}

async function bootstrap(): Promise<void> {
  const userDataPath = app.getPath("userData");
  const database = openDatabase(
    path.join(userDataPath, "workbench.db"),
    getOrCreateDatabaseKey(),
    { backupDirectory: path.join(userDataPath, "backups") },
  );
  const leaseRepository = new LeaseRepository(database);

  const box: { state?: AppState } = {};
  const stateRef = () => {
    if (!box.state) throw new Error("AppState not ready");
    return box.state;
  };
  const approvalBroker = new RepositoryApprovalBroker({
    findById: (id: string) => stateRef().approvals.findById(id),
  });
  const { taskIdForRun, leaseIdsForRun } = runtimeDependencies(
    stateRef,
    () => leaseRepository,
  );
  const runtimeCommands = resolveRuntimeCommands(locateLocalBinary);
  const agyBinary = locateLocalBinary("agy");
  const agyCommand = runtimeCommands.agy;
  const agyPluginManager = new AgyPluginManager({
    command: agyCommand,
    sourceDirectory: path.join(app.getPath("userData"), "agy-companion-plugin"),
    hookScriptPath: path.resolve(app.getAppPath(), "bin/okami-agy-hook.mjs"),
    execute: async (command, args, options) => {
      const { stdout } = await execFileAsync(command, args, {
        env: options.env,
        timeout: 5_000,
        windowsHide: true,
      });
      return { stdout: String(stdout) };
    },
  });
  if (agyBinary) {
    try {
      await agyPluginManager.ensureEnabled();
    } catch {
      // AGY remains visible with a protocol-health error; one optional runtime
      // must never prevent the rest of the desktop from starting.
      console.error("[okami] AGY companion provisioning failed");
    }
  }
  const runtimes = createRuntimeRegistry({
    claude: {
      policyEngine: {
        authorize: (request) => stateRef().policyEngine.authorize(request),
      },
      approvalBroker,
      taskIdForRun,
      leaseIdsForRun,
      hookScriptPath: path.resolve(app.getAppPath(), "bin/okami-hook.mjs"),
      command: runtimeCommands.claude,
    },
    codex: {
      approvalBroker,
      taskIdForRun,
    },
    cursor: {
      taskIdForRun,
      command: runtimeCommands.cursor,
    },
    agy: {
      taskIdForRun,
      command: agyCommand,
      pluginStatus: () => agyPluginManager.status(),
      companionFactory: (onHook) => new AgyCompanionServer({ onHook }),
      authorizer: createAgyPolicyAuthorizer({
        policyEngine: {
          authorize: (request) => stateRef().policyEngine.authorize(request),
        },
        approvalBroker,
        taskIdForRun,
        leaseIdsForRun,
        workspacePathForLane: (laneId) =>
          stateRef().lanes.findById(laneId)?.workspacePath ?? null,
        permissionModeForLane: (laneId) =>
          stateRef().lanes.findById(laneId)?.permissionMode ?? undefined,
      }),
    },
    grok: {
      taskIdForRun,
      command: runtimeCommands.grok,
    },
    mimo: {
      taskIdForRun,
      command: runtimeCommands.mimo,
    },
    minimax: {
      taskIdForRun,
      command: runtimeCommands.minimax,
    },
    opencode: {
      taskIdForRun,
      command: runtimeCommands.opencode,
    },
  });

  const chatgptProfile = createGatewayProfile({
    id: "chatgpt",
    provider: "chatgpt",
    kind: "bridged",
    env: {},
    displayQuotaAccount: "ChatGPT",
  });
  const laneEffort = new Map<string, string>();
  const gateway = await startGatewayServer({
    effortResolver: (laneId) => laneEffort.get(laneId),
    profiles: [
      {
        profile: chatgptProfile,
        bridge: createChatGptBridge(createCodexChatGptBackend(), {
          model: GPT_BACKEND_MODEL,
        }),
      },
    ],
  });
  const opencodeHealth = await runtimes
    .health("opencode")
    .then(({ health }) => health)
    .catch(() => ({
      available: false,
      protocolSupported: false,
      version: null,
    }));

  const modelCatalogService = createModelCatalogService({
    cachePath: path.join(app.getPath("userData"), "claude-models.json"),
    cursorCachePath: path.join(app.getPath("userData"), "cursor-models.json"),
    cursorBinary: locateLocalBinary("cursor"),
    agyCachePath: path.join(app.getPath("userData"), "agy-models.json"),
    agyBinary: agyCommand,
    grokCachePath: path.join(app.getPath("userData"), "grok-models.json"),
    grokBinary: locateLocalBinary("grok"),
    minimaxCachePath: path.join(app.getPath("userData"), "minimax-models.json"),
    minimaxBinary: locateLocalBinary("minimax"),
    mimoCachePath: path.join(app.getPath("userData"), "mimo-models.json"),
    mimoBinary: locateLocalBinary("mimo"),
    opencodeBinary: locateLocalBinary("opencode"),
    opencodeAcpReady:
      opencodeHealth.available && opencodeHealth.protocolSupported,
  });
  const modelFavoritesService = new ModelFavoritesService({
    filePath: path.join(app.getPath("userData"), "model-favorites.json"),
  });
  if (process.env.OKAMI_RUN_LIVE_CLI_TESTS !== "0") {
    void modelCatalogService.refreshClaude();
    void modelCatalogService.refreshCursor();
    void modelCatalogService.refreshAgy();
    void modelCatalogService.refreshGrok();
    void modelCatalogService.refreshMiniMax();
    void modelCatalogService.refreshMimo();
  }

  const state = createAppState({
    database,
    runtimes,
    gateway: {
      port: gateway.port,
      bearerToken: gateway.bearerToken,
      gatewayConfigRoot: path.join(app.getPath("userData"), "gateway-config"),
      accounts: [
        {
          provider: "chatgpt",
          bridgedProfile: chatgptProfile,
          nativeRuntime: "codex",
        },
      ],
    },
    reportBackgroundError: (error) => {
      console.error("[okami] background error", error);
    },
  });
  box.state = state;
  const recovery = new StartupRecovery({
    db: database,
    runs: state.runs,
    approvals: state.approvals,
    audit: new AuditRepository(database),
    // A freshly booted process cannot own children from the previous process.
    // Keeping the supervisor explicit preserves the ownership boundary when
    // adapters are routed through it in a later runtime lifecycle pass.
    supervisor: new RuntimeSupervisor(),
    createId: state.createId,
    clock: state.clock,
  }).reconcileStartup();
  if (recovery.interruptedRuns > 0) {
    console.warn("[okami] recovered interrupted runs", recovery);
  }
  // Repairs an earlier seed that used an invalid Claude model id.
  database
    .prepare(
      "UPDATE runtime_lanes SET model = 'opus' WHERE model = 'claude-opus'",
    )
    .run();
  seedInitialWorkspace(state);
  memoryService = new MemoryService({ db: database });
  const memoryStart = memoryService.start();
  for (const failure of memoryStart.failed) {
    console.warn("[okami] memory source unavailable", failure);
  }
  const storedInboxCredentialVault = new ConnectorCredentialVault(
    path.join(app.getPath("userData"), "inbox-credentials"),
    safeStorage,
  );
  const inboxCredentialVault = new RefreshingCredentialVault(
    storedInboxCredentialVault,
  );
  const calendarService = new CalendarApplicationService({
    db: database,
    calendar: new CalendarService({
      db: database,
      createId: randomUUID,
      clock: () => new Date().toISOString(),
    }),
    synchronizer: new RemoteCalendarAdapter(inboxCredentialVault),
    googleSynchronizer: new GoogleCalendarAdapter(inboxCredentialVault),
    createId: randomUUID,
    clock: () => new Date(),
  });
  calendarService.reconcileInboxInvitationSources();
  await calendarService.reconcileGoogleSources();
  const inboxService = new InboxApplicationService({
    db: database,
    vault: inboxCredentialVault,
    createAdapter: (vault) => new ImapSyncAdapter(vault),
    calendarInvitations: {
      import: (input) => calendarService.importInboxInvitations(input),
    },
    createId: randomUUID,
    clock: () => new Date(),
  });
  inboxSyncScheduler = new InboxSyncScheduler(inboxService, {
    reportError: (error, summary) =>
      console.warn("[okami] automatic inbox sync failed", {
        accountId: summary?.account.id ?? null,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
  });
  inboxSyncScheduler.start();
  const inboxReplyDispatchService = new ReplyDispatchService({
    db: database,
    vault: inboxCredentialVault,
  });
  const googleInboxOAuthService = new GoogleInboxOAuthService({
    authorizer: new GoogleOAuthAuthorizer({
      openExternal: (url) => shell.openExternal(url),
    }),
    inbox: inboxService,
    vault: storedInboxCredentialVault,
    calendar: calendarService,
    pickClientFile: async () => {
      const result = await dialog.showOpenDialog({
        title: "Selecionar credenciais OAuth do Google",
        buttonLabel: "Usar este JSON",
        filters: [
          {
            name: "Credenciais OAuth do Google",
            extensions: ["json"],
          },
        ],
        properties: ["openFile"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  const recoveredReplyDispatches =
    inboxReplyDispatchService.recoverInterruptedDispatches();
  if (recoveredReplyDispatches > 0) {
    console.warn("[okami] recovered interrupted email dispatches", {
      recoveredReplyDispatches,
    });
  }
  registerIpcHandlers({
    ipcMain,
    laneEffort,
    modelCatalog: () => modelCatalogService.list(),
    modelFavoritesService,
    rendererUrl:
      process.env.ELECTRON_RENDERER_URL ??
      `file://${path.join(import.meta.dirname, "../renderer/index.html")}`,
    state,
    memoryService,
    inboxService,
    inboxReplyDispatchService,
    googleInboxOAuthService,
    calendarService,
    openExternal: (url) => shell.openExternal(url),
    showItemInFolder: async (targetPath) => shell.showItemInFolder(targetPath),
  });
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    console.error("[okami] bootstrap failed", error);
    const failureWindow = new BrowserWindow({
      width: 760,
      height: 520,
      minWidth: 640,
      minHeight: 420,
      webPreferences: secureWebPreferences,
    });
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    await failureWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        bootstrapFailurePage({
          code,
          development: !app.isPackaged,
        }),
      )}`,
    );
    return;
  }
  createMainWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  inboxSyncScheduler?.stop();
  void memoryService?.close();
});
