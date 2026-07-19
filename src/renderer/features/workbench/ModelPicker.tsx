import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkbenchLane } from "./api";

interface ModelPickerProps {
  disabled?: boolean;
  isOpening: boolean;
  lanes: WorkbenchLane[];
  onSelect: (laneId: string) => void;
  selectedLaneId: string | null;
}

export function modelLabel(lane: WorkbenchLane): string {
  const model = lane.model
    .replace(/^claude-/u, "Claude ")
    .replace(/^gpt-?/iu, "GPT-")
    .replace(/\b\w/u, (char) => char.toUpperCase());
  return model;
}

export function modelDetail(lane: WorkbenchLane): string {
  const via =
    lane.harness === "claude" && lane.runtimeKind !== "claude"
      ? " · via harness Claude"
      : "";
  return `${lane.displayQuotaAccount}${via}`;
}

export function ModelPicker({
  disabled,
  isOpening,
  lanes,
  onSelect,
  selectedLaneId,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    lanes.find((lane) => lane.laneId === selectedLaneId) ?? lanes[0] ?? null;

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

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Selecionar modelo"
        className="model-picker__button"
        disabled={disabled || lanes.length === 0}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {selected ? (
          <>
            <span
              aria-hidden="true"
              className={`route-dot route-dot--${selected.routeKind}`}
            />
            {isOpening ? "Trocando…" : modelLabel(selected)}
          </>
        ) : (
          "Sem modelos"
        )}
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {open && (
        <div
          aria-label="Modelos disponíveis"
          className="model-picker__menu"
          role="listbox"
        >
          {lanes.map((lane) => (
            <button
              aria-selected={lane.laneId === selected?.laneId}
              className="model-picker__option"
              key={lane.laneId}
              onClick={() => {
                setOpen(false);
                if (lane.laneId !== selectedLaneId) onSelect(lane.laneId);
              }}
              role="option"
              type="button"
            >
              <span
                aria-hidden="true"
                className={`route-dot route-dot--${lane.routeKind}`}
              />
              <span className="model-picker__option-meta">
                {modelLabel(lane)}
                <small>{modelDetail(lane)}</small>
              </span>
              {lane.laneId === selected?.laneId && (
                <Check
                  aria-hidden="true"
                  className="model-picker__check"
                  size={14}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
