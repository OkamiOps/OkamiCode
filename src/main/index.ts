import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { ConnectorCredentialVault } from "./connectors/credential-vault";
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
import { createRuntimeRegistry } from "./runtime/registry";
import { RuntimeSupervisor } from "./runtime/supervisor";
import { getOrCreateDatabaseKey } from "./secrets";
import { MemoryService } from "./memory/indexer";
import { StartupRecovery } from "./orchestration/recovery";
import { AuditRepository } from "./db/repositories/audit";
import { secureWebPreferences } from "./window";
import { InboxApplicationService } from "./inbox/application-service";
import { ImapSyncAdapter } from "./inbox/imap-adapter";
import { ReplyDispatchService } from "./inbox/reply-dispatch-service";
import type { Capability } from "./policy/action";
import type { TaskId } from "../shared/ids";

const GPT_BACKEND_MODEL = "gpt-5.6-sol";
const LEASED_CAPABILITIES: Capability[] = [
  "workspace.read",
  "workspace.write",
  "terminal.exec",
  "browser.open",
];
let memoryService: MemoryService | undefined;

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
  const database = openDatabase(
    path.join(app.getPath("userData"), "workbench.db"),
    getOrCreateDatabaseKey(),
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
  const runtimes = createRuntimeRegistry({
    claude: {
      policyEngine: {
        authorize: (request) => stateRef().policyEngine.authorize(request),
      },
      approvalBroker,
      taskIdForRun,
      leaseIdsForRun,
      hookScriptPath: path.resolve(app.getAppPath(), "bin/okami-hook.mjs"),
    },
    codex: {
      approvalBroker,
      taskIdForRun,
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

  const modelCatalogService = createModelCatalogService({
    cachePath: path.join(app.getPath("userData"), "claude-models.json"),
  });
  void modelCatalogService.refreshClaude();

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
  const inboxCredentialVault = new ConnectorCredentialVault(
    path.join(app.getPath("userData"), "inbox-credentials"),
    safeStorage,
  );
  const inboxService = new InboxApplicationService({
    db: database,
    vault: inboxCredentialVault,
    createAdapter: (vault) => new ImapSyncAdapter(vault),
    createId: randomUUID,
    clock: () => new Date(),
  });
  const inboxReplyDispatchService = new ReplyDispatchService({
    db: database,
    vault: inboxCredentialVault,
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
    rendererUrl:
      process.env.ELECTRON_RENDERER_URL ??
      `file://${path.join(import.meta.dirname, "../renderer/index.html")}`,
    state,
    memoryService,
    inboxService,
    inboxReplyDispatchService,
  });
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
  } catch (error) {
    console.error("[okami] bootstrap failed", error);
  }
  createMainWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  void memoryService?.close();
});
