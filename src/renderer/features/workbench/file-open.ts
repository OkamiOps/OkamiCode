import { createContext, useContext } from "react";

export interface FileOpener {
  workspacePath: string | null;
  open(relativePath: string): void;
}

export const FileOpenContext = createContext<FileOpener | null>(null);

export function useFileOpener(): FileOpener | null {
  return useContext(FileOpenContext);
}

// A path is openable when it lands inside the conversation folder. Absolute
// paths get the workspace prefix stripped; relative ones are already there.
export function toWorkspaceRelative(
  candidate: string,
  workspacePath: string | null,
): string | null {
  const trimmed = candidate.trim().replace(/[),.;:]+$/u, "");
  if (!trimmed || trimmed.includes("\n") || trimmed.length > 400) return null;
  const looksLikePath =
    trimmed.includes("/") || /\.[A-Za-z0-9]{1,8}$/u.test(trimmed);
  if (!looksLikePath) return null;
  if (!trimmed.startsWith("/")) {
    return trimmed.startsWith("..") ? null : trimmed;
  }
  if (!workspacePath) return null;
  const root = workspacePath.replace(/\/+$/u, "");
  if (trimmed === root) return "";
  return trimmed.startsWith(`${root}/`) ? trimmed.slice(root.length + 1) : null;
}
