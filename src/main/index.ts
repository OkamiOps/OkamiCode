import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { openDatabase } from "./db/connection";
import { createAppState, type AppState } from "./ipc/app-state";
import { registerIpcHandlers } from "./ipc/handlers";
import { createChatGptBridge } from "./gateway/bridges/chatgpt";
import { createCodexChatGptBackend } from "./gateway/bridges/chatgpt-backend";
import { createGatewayProfile } from "./gateway/profile";
import { startGatewayServer } from "./gateway/server";
import { LeaseRepository, type CapabilityLease } from "./policy/lease";
import { RepositoryApprovalBroker } from "./runtime/codex/adapter";
import { createRuntimeRegistry } from "./runtime/registry";
import { getOrCreateDatabaseKey } from "./secrets";
import { secureWebPreferences } from "./window";
import type { Capability } from "./policy/action";
import type { TaskId } from "../shared/ids";

const GPT_BACKEND_MODEL = "gpt-5.6-sol";
const LEASED_CAPABILITIES: Capability[] = [
  "workspace.read",
  "workspace.write",
  "terminal.exec",
];

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
        resourcePattern: `${workspace}/**`,
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
  insertLane("claude", "claude_max", "claude-opus");
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
  const gateway = await startGatewayServer({
    profiles: [
      {
        profile: chatgptProfile,
        bridge: createChatGptBridge(createCodexChatGptBackend(), {
          model: GPT_BACKEND_MODEL,
        }),
      },
    ],
  });

  const state = createAppState({
    database,
    runtimes,
    gateway: {
      port: gateway.port,
      bearerToken: gateway.bearerToken,
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
  seedInitialWorkspace(state);
  registerIpcHandlers({
    ipcMain,
    rendererUrl:
      process.env.ELECTRON_RENDERER_URL ??
      `file://${path.join(import.meta.dirname, "../renderer/index.html")}`,
    state,
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
