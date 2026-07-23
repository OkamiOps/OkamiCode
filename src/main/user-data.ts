import path from "node:path";

const LEGACY_USER_DATA_DIRECTORY = "okami-workbench";

export interface ResolveUserDataPathOptions {
  appDataPath: string;
  currentUserDataPath: string;
  override?: string;
  pathExists: (candidate: string) => boolean;
}

export function resolveUserDataPath(
  options: ResolveUserDataPathOptions,
): string {
  if (options.override) {
    return options.override;
  }

  const legacyUserDataPath = path.join(
    options.appDataPath,
    LEGACY_USER_DATA_DIRECTORY,
  );
  if (options.pathExists(path.join(legacyUserDataPath, "workbench.db"))) {
    return legacyUserDataPath;
  }

  return options.currentUserDataPath;
}
