import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  modelFavoritesSchema,
  type ModelFavorite,
} from "../../shared/contracts/ipc";

interface ModelFavoritesServiceOptions {
  filePath: string;
}

function favoriteKey(favorite: ModelFavorite): string {
  return `${favorite.runtimeKind}\u0000${favorite.modelId}`;
}

export class ModelFavoritesService {
  private readonly filePath: string;

  constructor({ filePath }: ModelFavoritesServiceOptions) {
    this.filePath = filePath;
  }

  list(): ModelFavorite[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      const favorites = modelFavoritesSchema.parse(parsed);
      return [
        ...new Map(favorites.map((item) => [favoriteKey(item), item])).values(),
      ].sort((left, right) =>
        favoriteKey(left).localeCompare(favoriteKey(right)),
      );
    } catch {
      return [];
    }
  }

  set(input: ModelFavorite & { favorite: boolean }): ModelFavorite[] {
    const nextFavorite = {
      runtimeKind: input.runtimeKind,
      modelId: input.modelId,
    } satisfies ModelFavorite;
    const favorites = new Map(
      this.list().map((item) => [favoriteKey(item), item] as const),
    );
    if (input.favorite) favorites.set(favoriteKey(nextFavorite), nextFavorite);
    else favorites.delete(favoriteKey(nextFavorite));

    const next = [...favorites.values()].sort((left, right) =>
      favoriteKey(left).localeCompare(favoriteKey(right)),
    );
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
    return next;
  }
}
