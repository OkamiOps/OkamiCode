import chokidar, { type FSWatcher } from "chokidar";
import type { MemorySource } from "./config";

export function watchSource(
  source: MemorySource,
  reindex: () => void,
): FSWatcher {
  return chokidar
    .watch(source.scopePath, {
      ignored: (candidate) => /(^|\/)\.[^/]+/u.test(candidate),
      ignoreInitial: true,
      followSymlinks: false,
    })
    .on("add", reindex)
    .on("change", reindex)
    .on("unlink", reindex);
}
