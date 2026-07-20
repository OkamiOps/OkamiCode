import chokidar, { type FSWatcher } from "chokidar";
import type { MemorySource } from "./config";

export type MemoryWatcher = Pick<FSWatcher, "close">;
export type MemoryWatchEvent = {
  kind: "upsert" | "remove";
  path: string;
};

export function watchSource(
  source: MemorySource,
  onChange: (event: MemoryWatchEvent) => void,
): MemoryWatcher {
  return chokidar
    .watch(source.scopePath, {
      ignored: (candidate) => /(^|\/)\.[^/]+/u.test(candidate),
      ignoreInitial: true,
      followSymlinks: false,
    })
    .on("add", (filePath) => onChange({ kind: "upsert", path: filePath }))
    .on("change", (filePath) => onChange({ kind: "upsert", path: filePath }))
    .on("unlink", (filePath) => onChange({ kind: "remove", path: filePath }));
}
