import { Button, Chip } from "@heroui/react";
import { Link2, X } from "lucide-react";

export interface ContextChipItem {
  label: string;
  ref: string;
}

interface ContextChipsProps {
  chips: ContextChipItem[];
  onRemove: (ref: string) => void;
}

export function ContextChips({ chips, onRemove }: ContextChipsProps) {
  if (chips.length === 0) {
    return (
      <p className="m-0 text-[11px] text-[var(--ok-text-muted)]">
        Nenhum contexto selecionado. Nada será importado automaticamente.
      </p>
    );
  }

  return (
    <div
      aria-label="Contexto selecionado"
      className="flex flex-wrap items-center gap-1.5"
    >
      {chips.map((chip) => (
        <Chip
          className="border border-[color-mix(in_srgb,var(--ok-cyan)_32%,var(--ok-border))] bg-[var(--ok-bg)] text-[var(--ok-text)]"
          key={chip.ref}
          size="sm"
          variant="secondary"
        >
          <span className="inline-flex items-center gap-1.5">
            <Link2
              aria-hidden="true"
              className="text-[var(--ok-cyan)]"
              size={11}
            />
            {chip.label}
            <Button
              aria-label={`Remover ${chip.label}`}
              className="-mr-1 size-5 min-h-5 min-w-5 text-[var(--ok-text-muted)] hover:text-[var(--ok-red)]"
              isIconOnly
              size="sm"
              type="button"
              variant="ghost"
              onPress={() => onRemove(chip.ref)}
            >
              <X aria-hidden="true" size={11} />
            </Button>
          </span>
        </Chip>
      ))}
    </div>
  );
}
