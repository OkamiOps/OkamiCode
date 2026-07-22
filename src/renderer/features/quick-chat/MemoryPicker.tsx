import { Button, Input } from "@heroui/react";
import { Brain, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import { workbenchClient } from "../../lib/ipc/client";
import type { ContextChipItem } from "./ContextChips";

type MemoryResult = IpcResponse<"memory:search">[number];

const defaultSearch = (query: string) =>
  workbenchClient.memorySearch({ query });

interface MemoryPickerProps {
  search?: (query: string) => Promise<MemoryResult[]>;
  onSelect: (chip: ContextChipItem) => void;
}

export function MemoryPicker({
  search = defaultSearch,
  onSelect,
}: MemoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    let current = true;
    void search(query.trim())
      .then((next) => {
        if (current) {
          setResults(next);
          setError(null);
        }
      })
      .catch(
        () => current && setError("Não foi possível pesquisar a memória."),
      );
    return () => {
      current = false;
    };
  }, [open, query, search]);

  return (
    <div className="relative shrink-0">
      <Button
        aria-expanded={open}
        className="border border-[var(--ok-border)] text-[var(--ok-text-muted)]"
        size="sm"
        type="button"
        variant="ghost"
        onPress={() => setOpen((value) => !value)}
      >
        <Brain aria-hidden="true" size={13} />
        Memória
      </Button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-[min(28rem,calc(100vw-2rem))] rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-1)] p-2 shadow-xl">
          <Input
            aria-label="Pesquisar memória"
            fullWidth
            placeholder="Buscar nas pastas indexadas…"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto">
            {results.map((result) => (
              <button
                className="rounded-[var(--ok-radius-sm)] px-2 py-2 text-left hover:bg-[var(--ok-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ok-cyan)]"
                key={result.id}
                type="button"
                onClick={() => {
                  onSelect({ label: result.title, ref: `memory:${result.id}` });
                  setOpen(false);
                }}
              >
                <span className="block truncate text-xs font-medium text-[var(--ok-text)]">
                  {result.title}
                </span>
                <span className="block truncate text-[10px] text-[var(--ok-text-muted)]">
                  {result.path}
                </span>
                <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-[var(--ok-text-muted)]">
                  {result.excerpt}
                </span>
              </button>
            ))}
            {query.trim().length >= 2 && results.length === 0 && !error && (
              <p className="m-2 text-[11px] text-[var(--ok-text-muted)]">
                Nenhuma nota encontrada.
              </p>
            )}
            {error && (
              <p className="m-2 text-[11px] text-[var(--ok-red)]">{error}</p>
            )}
          </div>
        </div>
      )}
      <Search aria-hidden="true" className="sr-only" />
    </div>
  );
}
