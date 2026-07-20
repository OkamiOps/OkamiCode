import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Zap } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

const FAVOURITES_KEY = "okami.favouriteModels";

function loadFavourites(): string[] {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// The catalogue the CLIs report, with favourites and a one-click switch for
// the open conversation.
export function ModelsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const [favourites, setFavourites] = useState<string[]>(loadFavourites);
  const [filter, setFilter] = useState("");

  const catalog = useQuery({
    queryKey: ["workbench", "models"],
    queryFn: () => workbenchClient.modelsList(),
  });
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const task =
    (tasks.data ?? []).find((entry) => entry.id === selectedTaskId) ??
    (tasks.data ?? [])[0];

  const ensureLane = useMutation({
    mutationFn: workbenchClient.laneEnsure,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workbench", "lanes"] });
      navigate("/workbench");
    },
  });

  const toggleFavourite = (id: string) => {
    setFavourites((current) => {
      const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id];
      try {
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
      } catch {
        // Favourites are a convenience; failing to persist is not fatal.
      }
      return next;
    });
  };

  const term = filter.trim().toLowerCase();

  return (
    <section aria-label="Modelos" className="eco-page">
      <header className="eco-page__header">
        <h1>Modelos</h1>
        <p>
          Catálogo que os CLIs reportam para esta conta. Marcar favoritos e
          trocar o modelo da conversa aberta.
        </p>
      </header>

      <input
        aria-label="Filtrar modelos"
        className="eco-filter"
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filtrar modelos…"
        value={filter}
      />

      {(catalog.data ?? []).map((entry) => {
        const models = entry.models.filter(
          (model) =>
            term === "" ||
            model.id.toLowerCase().includes(term) ||
            model.label.toLowerCase().includes(term),
        );
        if (models.length === 0) return null;
        return (
          <section className="eco-card" key={entry.providerLabel}>
            <h2>
              <Zap aria-hidden="true" size={15} />
              {entry.providerLabel}
              <span className="eco-tag eco-tag--muted">
                {entry.routeKind === "bridged"
                  ? "via harness Claude"
                  : "nativo"}
              </span>
              <span className="eco-count">{models.length}</span>
            </h2>
            <ul className="eco-list">
              {models.map((model) => (
                <li key={model.id}>
                  <button
                    aria-label={`Favoritar ${model.label}`}
                    className="eco-icon"
                    data-active={favourites.includes(model.id) || undefined}
                    onClick={() => toggleFavourite(model.id)}
                    type="button"
                  >
                    <Star aria-hidden="true" size={13} />
                  </button>
                  <span className="eco-list__main">
                    <strong>{model.label}</strong>
                    <small>
                      {model.description ?? model.id}
                      {model.efforts?.length
                        ? ` · efforts: ${model.efforts.join(", ")}`
                        : " · sem níveis de effort"}
                    </small>
                  </span>
                  <button
                    className="eco-action"
                    disabled={!task || ensureLane.isPending}
                    onClick={() =>
                      task &&
                      ensureLane.mutate({
                        taskId: task.id,
                        runtimeKind: entry.runtimeKind,
                        model: model.id,
                      })
                    }
                    type="button"
                  >
                    Usar na conversa
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {catalog.data?.length === 0 && (
        <p className="eco-empty">
          Catálogo indisponível — os CLIs responderam vazio.
        </p>
      )}
    </section>
  );
}
