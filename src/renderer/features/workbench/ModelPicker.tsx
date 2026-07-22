import { Check, ChevronDown, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelCatalog, ModelFavorites, WorkbenchLane } from "./api";
import type { RuntimeKind } from "../../../shared/contracts/lane";

function isRunnableRuntime(runtime: string): runtime is RuntimeKind {
  return ["claude", "codex", "cursor", "agy", "grok", "mimo"].includes(runtime);
}

interface ModelPickerProps {
  catalog: ModelCatalog;
  favorites: ModelFavorites;
  disabled?: boolean;
  isOpening: boolean;
  onSelectModel: (runtimeKind: RuntimeKind, model: string) => void;
  selectedLane: WorkbenchLane | null;
}

export function formatModel(model: string): string {
  return model
    .replace(/^claude-/u, "Claude ")
    .replace(/^gpt-?/iu, "GPT-")
    .replace(/\b\w/u, (char) => char.toUpperCase());
}

export function modelLabel(lane: WorkbenchLane): string {
  return formatModel(lane.model);
}

export function modelDetail(lane: WorkbenchLane): string {
  const via =
    lane.harness === "claude" && lane.runtimeKind !== "claude"
      ? " · via harness Claude"
      : "";
  return `${lane.displayQuotaAccount}${via}`;
}

export function ModelPicker({
  catalog,
  favorites,
  disabled,
  isOpening,
  onSelectModel,
  selectedLane,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasModels = catalog.some((entry) => entry.models.length > 0);
  const normalizeModelId = (id: string) => id.replace(/\[1m\]$/u, "");
  const selectedCatalogModel = selectedLane
    ? catalog
        .flatMap((entry) => entry.models)
        .find(
          (model) =>
            normalizeModelId(model.id) === normalizeModelId(selectedLane.model),
        )
    : undefined;

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Selecionar modelo"
        className="model-picker__button"
        disabled={disabled || !hasModels}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {selectedLane ? (
          <>
            <span
              aria-hidden="true"
              className={`route-dot route-dot--${selectedLane.routeKind}`}
            />
            {isOpening
              ? "Trocando…"
              : (selectedCatalogModel?.label ?? modelLabel(selectedLane))}
          </>
        ) : (
          "Escolher modelo"
        )}
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {open &&
        (() => {
          // Provider column first, models second: the list stays short even
          // as more providers (Grok, Cursor, Minimax, …) plug in.
          const providerKey = (entry: ModelCatalog[number]) =>
            `${entry.runtimeKind}-${entry.providerLabel}`;
          const owningProvider = selectedLane
            ? catalog.find((entry) =>
                entry.models.some(
                  (model) =>
                    normalizeModelId(model.id) ===
                    normalizeModelId(selectedLane.model),
                ),
              )
            : undefined;
          const fallbackProvider =
            catalog.find((entry) => entry.models.length > 0) ?? catalog[0];
          const activeEntry =
            catalog.find((entry) => providerKey(entry) === activeProvider) ??
            owningProvider ??
            fallbackProvider;
          const showingFavorites = activeProvider === "favorites";
          const favoriteModels = favorites.flatMap((favorite) => {
            const provider = catalog.find(
              (entry) => entry.runtimeKind === favorite.runtimeKind,
            );
            const model = provider?.models.find(
              (entry) =>
                normalizeModelId(entry.id) ===
                normalizeModelId(favorite.modelId),
            );
            return provider && model ? [{ provider, model }] : [];
          });
          return (
            <div
              aria-label="Modelos disponíveis"
              className="model-picker__menu model-picker__menu--dual"
            >
              <div
                aria-label="Providers"
                className="model-picker__providers"
                role="tablist"
                tabIndex={0}
              >
                <button
                  aria-selected={showingFavorites}
                  className="model-picker__provider"
                  data-active={showingFavorites || undefined}
                  onClick={() => setActiveProvider("favorites")}
                  role="tab"
                  type="button"
                >
                  <Star aria-hidden="true" size={13} />
                  <span className="model-picker__provider-meta">
                    Favoritos
                    <small>acesso rápido · {favoriteModels.length}</small>
                  </span>
                </button>
                {catalog.map((entry) => (
                  <button
                    aria-selected={
                      !showingFavorites &&
                      providerKey(entry) === providerKey(activeEntry)
                    }
                    className="model-picker__provider"
                    data-active={
                      (!showingFavorites &&
                        providerKey(entry) === providerKey(activeEntry)) ||
                      undefined
                    }
                    key={providerKey(entry)}
                    onClick={() => setActiveProvider(providerKey(entry))}
                    role="tab"
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`route-dot route-dot--${entry.routeKind}`}
                    />
                    <span className="model-picker__provider-meta">
                      {entry.providerLabel}
                      <small>
                        {entry.routeKind === "unavailable"
                          ? "catálogo apenas"
                          : entry.routeKind === "bridged"
                            ? "via harness Claude"
                            : "nativo"}
                        {" · "}
                        {entry.models.length}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <div
                aria-label={
                  showingFavorites
                    ? "Modelos favoritos"
                    : `Modelos de ${activeEntry.providerLabel}`
                }
                className="model-picker__models"
                role="listbox"
              >
                {showingFavorites && favoriteModels.length === 0 && (
                  <div className="model-picker__empty">
                    Marque modelos com estrela na tela Modelos.
                  </div>
                )}
                {showingFavorites &&
                  favoriteModels.map(({ provider, model }) => {
                    const isSelected =
                      selectedLane !== null &&
                      selectedLane.runtimeKind === provider.runtimeKind &&
                      normalizeModelId(selectedLane.model) ===
                        normalizeModelId(model.id);
                    return (
                      <button
                        aria-selected={isSelected}
                        className="model-picker__option"
                        disabled={
                          provider.routeKind === "unavailable" ||
                          !isRunnableRuntime(provider.runtimeKind)
                        }
                        key={`${provider.runtimeKind}-${model.id}`}
                        onClick={() => {
                          setOpen(false);
                          if (
                            !isSelected &&
                            provider.routeKind !== "unavailable" &&
                            isRunnableRuntime(provider.runtimeKind)
                          ) {
                            onSelectModel(provider.runtimeKind, model.id);
                          }
                        }}
                        role="option"
                        type="button"
                      >
                        <Star
                          aria-hidden="true"
                          fill="currentColor"
                          size={13}
                        />
                        <span className="model-picker__option-meta">
                          {model.label}
                          <small>
                            {provider.providerLabel}
                            {model.description ? ` · ${model.description}` : ""}
                          </small>
                        </span>
                        {isSelected && (
                          <Check
                            aria-hidden="true"
                            className="model-picker__check"
                            size={14}
                          />
                        )}
                      </button>
                    );
                  })}
                {!showingFavorites && activeEntry.models.length === 0 && (
                  <div className="model-picker__empty">
                    {activeEntry.source}
                  </div>
                )}
                {!showingFavorites &&
                  activeEntry.models.map((model) => {
                    const isSelected =
                      selectedLane !== null &&
                      normalizeModelId(selectedLane.model) ===
                        normalizeModelId(model.id);
                    return (
                      <button
                        aria-selected={isSelected}
                        className="model-picker__option"
                        disabled={
                          activeEntry.routeKind === "unavailable" ||
                          !isRunnableRuntime(activeEntry.runtimeKind)
                        }
                        key={model.id}
                        onClick={() => {
                          setOpen(false);
                          if (
                            !isSelected &&
                            activeEntry.routeKind !== "unavailable" &&
                            isRunnableRuntime(activeEntry.runtimeKind)
                          )
                            onSelectModel(activeEntry.runtimeKind, model.id);
                        }}
                        role="option"
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={`route-dot route-dot--${activeEntry.routeKind}`}
                        />
                        <span className="model-picker__option-meta">
                          {model.label}
                          <small>
                            {model.description ?? activeEntry.providerLabel}
                          </small>
                        </span>
                        {isSelected && (
                          <Check
                            aria-hidden="true"
                            className="model-picker__check"
                            size={14}
                          />
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
