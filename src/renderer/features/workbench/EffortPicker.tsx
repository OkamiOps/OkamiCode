import { Check, ChevronDown, Gauge } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const EFFORT_LABELS: Record<string, string> = {
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "X-Alto",
  max: "Máximo",
  ultra: "Ultra",
};

export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort;
}

interface EffortPickerProps {
  disabled?: boolean;
  efforts: string[];
  onSelect: (effort: string) => void;
  selected: string | null;
}

export function EffortPicker({
  disabled,
  efforts,
  onSelect,
  selected,
}: EffortPickerProps) {
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

  // A vanished chip reads as broken; models without effort levels keep the
  // chip visible but inert, with the reason on hover.
  if (efforts.length === 0 || !selected) {
    return (
      <button
        aria-label="Effort indisponível para este modelo"
        className="model-picker__button model-picker__button--inert"
        disabled
        title="Este modelo não expõe níveis de effort"
        type="button"
      >
        <Gauge aria-hidden="true" size={13} />
        Effort —
      </button>
    );
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Selecionar effort"
        className="model-picker__button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Gauge aria-hidden="true" size={13} />
        {effortLabel(selected)}
        <ChevronDown aria-hidden="true" size={13} />
      </button>
      {open && (
        <div
          aria-label="Níveis de effort"
          className="model-picker__menu model-picker__menu--compact"
          role="listbox"
        >
          {efforts.map((effort) => (
            <button
              aria-selected={effort === selected}
              className="model-picker__option"
              key={effort}
              onClick={() => {
                setOpen(false);
                if (effort !== selected) onSelect(effort);
              }}
              role="option"
              type="button"
            >
              <span className="model-picker__option-meta">
                {effortLabel(effort)}
              </span>
              {effort === selected && (
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
