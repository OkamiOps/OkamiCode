import { execFileSync } from "node:child_process";
import nodePath from "node:path";

export type WorkspaceChangeStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflicted";

export interface WorkspaceChange {
  path: string;
  previousPath: string | null;
  status: WorkspaceChangeStatus;
  staged: boolean;
  unstaged: boolean;
}

const conflictStates = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function parsePorcelainStatus(input: string): WorkspaceChange[] {
  const records = input.split("\0");
  const changes: WorkspaceChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const code = record.slice(0, 2);
    const x = code[0] ?? " ";
    const y = code[1] ?? " ";
    const path = record.slice(3);
    const isRename = x === "R" || y === "R";
    const isCopy = x === "C" || y === "C";
    const previousPath = isRename || isCopy ? records[index + 1] || null : null;
    if (previousPath) index += 1;

    let status: WorkspaceChangeStatus = "modified";
    if (conflictStates.has(code) || x === "U" || y === "U")
      status = "conflicted";
    else if (code === "??") status = "untracked";
    else if (isRename) status = "renamed";
    else if (isCopy) status = "copied";
    else if (x === "D" || y === "D") status = "deleted";
    else if (x === "A" || y === "A") status = "added";

    changes.push({
      path,
      previousPath,
      status,
      staged: code === "??" ? false : x !== " " && x !== "?",
      unstaged: code === "??" ? true : y !== " " && y !== "?",
    });
  }
  return changes;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function readWorkspaceChanges(root: string) {
  try {
    const branch =
      git(root, ["branch", "--show-current"]).trim() || "HEAD detached";
    const changes = parsePorcelainStatus(
      git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    );
    return {
      isRepo: true as const,
      branch,
      files: changes,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      isRepo: false as const,
      branch: null,
      files: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export function readWorkspaceDiff(root: string, relativeFile: string) {
  const absolute = nodePath.resolve(root, relativeFile);
  if (absolute !== root && !absolute.startsWith(`${root}${nodePath.sep}`)) {
    throw new Error("Caminho fora da pasta da conversa");
  }
  const status = readWorkspaceChanges(root).files.find(
    (entry) => entry.path === relativeFile,
  );
  let patch = "";
  try {
    if (status?.status === "untracked") {
      try {
        patch = git(root, ["diff", "--no-index", "--", "/dev/null", absolute]);
      } catch (error) {
        patch = String((error as { stdout?: string }).stdout ?? "");
      }
    } else {
      const staged = git(root, ["diff", "--cached", "--", relativeFile]);
      const unstaged = git(root, ["diff", "--", relativeFile]);
      patch = [staged, unstaged].filter(Boolean).join("\n");
    }
  } catch {
    patch = "";
  }
  return { file: relativeFile, patch, truncated: false };
}
