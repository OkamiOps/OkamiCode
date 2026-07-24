import {
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function launchIsolatedApp(
  setupUserData?: (directory: string) => Promise<void>,
): Promise<ElectronApplication> {
  const userData = await mkdtemp(path.join(tmpdir(), "okamicode-e2e-"));
  await setupUserData?.(userData);
  return electron.launch({
    args: ["."],
    cwd: process.cwd(),
    env: {
      ...process.env,
      OKAMI_USER_DATA_DIR: userData,
      OKAMI_RUN_LIVE_CLI_TESTS: "0",
    },
  });
}
