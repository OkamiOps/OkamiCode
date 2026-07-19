import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelCatalog, WorkbenchLane } from "./api";

interface ModelPickerProps {
  catalog: ModelCatalog;
  disabled?: boolean;
  isOpening: boolean;
  onSelectModel: (runtimeKind: "claude" | "codex", model: string) => void;
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
            {isOpening ? "Trocando…" : modelLabel(selectedLane)}
          </>
        ) : (
          "Escolher modelo"
        )}
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {open && (
        <div
          aria-label="Modelos disponíveis"
          className="model-picker__menu"
          role="listbox"
        >
          {catalog.map((entry) => (
            <div key={`${entry.runtimeKind}-${entry.providerLabel}`}>
              <div className="model-picker__group">
                {entry.providerLabel}
                {entry.routeKind === "bridged" && " · via harness Claude"}
              </div>
              {entry.models.map((model) => {
                const isSelected =
                  selectedLane?.runtimeKind === entry.runtimeKind &&
                  selectedLane.model === model;
                return (
                  <button
                    aria-selected={isSelected}
                    className="model-picker__option"
                    key={model}
                    onClick={() => {
                      setOpen(false);
                      if (!isSelected) onSelectModel(entry.runtimeKind, model);
                    }}
                    role="option"
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={`route-dot route-dot--${entry.routeKind}`}
                    />
                    <span className="model-picker__option-meta">
                      {formatModel(model)}
                      <small>{entry.providerLabel}</small>
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
          ))}
        </div>
      )}
    </div>
  );
}
