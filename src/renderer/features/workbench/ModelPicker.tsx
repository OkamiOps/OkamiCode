import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelCatalog, WorkbenchLane } from "./api";
import type { RuntimeKind } from "../../../shared/contracts/lane";

interface ModelPickerProps {
  catalog: ModelCatalog;
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
          return (
            <div
              aria-label="Modelos disponíveis"
              className="model-picker__menu model-picker__menu--dual"
            >
              <div
                aria-label="Providers"
                className="model-picker__providers"
                role="tablist"
              >
                {catalog.map((entry) => (
                  <button
                    aria-selected={
                      providerKey(entry) === providerKey(activeEntry)
                    }
                    className="model-picker__provider"
                    data-active={
                      providerKey(entry) === providerKey(activeEntry) ||
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
                        {entry.routeKind === "bridged"
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
                aria-label={`Modelos de ${activeEntry.providerLabel}`}
                className="model-picker__models"
                role="listbox"
              >
                {activeEntry.models.length === 0 && (
                  <div className="model-picker__empty">
                    {activeEntry.source}
                  </div>
                )}
                {activeEntry.models.map((model) => {
                  const isSelected =
                    selectedLane !== null &&
                    normalizeModelId(selectedLane.model) ===
                      normalizeModelId(model.id);
                  return (
                    <button
                      aria-selected={isSelected}
                      className="model-picker__option"
                      key={model.id}
                      onClick={() => {
                        setOpen(false);
                        if (!isSelected)
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
