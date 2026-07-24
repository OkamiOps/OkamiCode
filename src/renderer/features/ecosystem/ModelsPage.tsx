import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  CircleAlert,
  HeartPulse,
  Search,
  Star,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { IpcResponse } from "../../../shared/contracts/ipc";
import type { RuntimeKind } from "../../../shared/contracts/lane";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

type Catalog = IpcResponse<"models:list">;
type CatalogEntry = Catalog[number];

function isRunnableRuntime(runtime: string): runtime is RuntimeKind {
  return [
    "claude",
    "codex",
    "cursor",
    "agy",
    "grok",
    "mimo",
    "minimax",
  ].includes(runtime);
}

function favoriteKey(runtimeKind: string, modelId: string): string {
  return `${runtimeKind}\u0000${modelId}`;
}

export function ModelsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const [filter, setFilter] = useState("");
  const [openProviders, setOpenProviders] = useState<Set<string>>(new Set());

  const catalog = useQuery({
    queryKey: ["workbench", "models"],
    queryFn: () => workbenchClient.modelsList(),
    refetchInterval: (query) =>
      query.state.data?.some((entry) => entry.source.startsWith("consultando"))
        ? 2_000
        : false,
  });
  const doctor = useQuery({
    queryKey: ["system", "doctor", "models"],
    queryFn: () => workbenchClient.systemDoctor(),
  });
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const favorites = useQuery({
    queryKey: ["workbench", "model-favorites"],
    queryFn: () => workbenchClient.modelFavoritesList(),
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
  const favoriteMutation = useMutation({
    mutationFn: workbenchClient.modelFavoriteSet,
    onSuccess: (next) => {
      queryClient.setQueryData(["workbench", "model-favorites"], next);
    },
  });
  const favoriteKeys = new Set(
    (favorites.data ?? []).map((favorite) =>
      favoriteKey(favorite.runtimeKind, favorite.modelId),
    ),
  );
  const term = filter.trim().toLowerCase();
  const favoriteModels = (catalog.data ?? []).flatMap((entry) =>
    entry.models
      .filter((model) =>
        favoriteKeys.has(favoriteKey(entry.runtimeKind, model.id)),
      )
      .map((model) => ({ entry, model })),
  );

  const handleModelUse = (entry: CatalogEntry, modelId: string) => {
    if (!task || !isRunnableRuntime(entry.runtimeKind)) return;
    ensureLane.mutate({
      taskId: task.id,
      runtimeKind: entry.runtimeKind,
      model: modelId,
    });
  };

  return (
    <section aria-labelledby="models-heading" className="models-page">
      <header className="models-page__header">
        <div>
          <p className="pane-kicker">Catálogo local</p>
          <h1 id="models-heading">Modelos</h1>
          <p>
            Escolha pelo provider, saúde do runtime e transporte que realmente
            executa.
          </p>
        </div>
        <div className="models-page__summary" aria-label="Resumo do catálogo">
          <strong>{catalog.data?.length ?? "—"}</strong>
          <span>providers</span>
          <strong>
            {catalog.data?.reduce(
              (total, entry) => total + entry.models.length,
              0,
            ) ?? "—"}
          </strong>
          <span>modelos</span>
        </div>
      </header>

      <div className="models-toolbar">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label="Filtrar modelos"
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Buscar modelo, capacidade ou provider…"
          value={filter}
        />
        {filter && (
          <button onClick={() => setFilter("")} type="button">
            Limpar
          </button>
        )}
      </div>

      <section
        className="models-favorites"
        aria-labelledby="favorite-models-heading"
      >
        <header>
          <Star aria-hidden="true" size={15} />
          <h2 id="favorite-models-heading">Acesso rápido</h2>
          <span>{favoriteModels.length} favoritos</span>
        </header>
        {favoriteModels.length ? (
          <div className="models-favorites__rail">
            {favoriteModels.map(({ entry, model }) => (
              <button
                disabled={
                  !task ||
                  entry.routeKind === "unavailable" ||
                  ensureLane.isPending
                }
                key={favoriteKey(entry.runtimeKind, model.id)}
                onClick={() => handleModelUse(entry, model.id)}
                type="button"
              >
                <span data-provider={entry.runtimeKind}>
                  {providerGlyph(entry.runtimeKind)}
                </span>
                <strong>{model.label}</strong>
                <small>
                  {entry.providerLabel} · {routeLabel(entry.routeKind)}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="models-favorites__empty">
            Marque a estrela dos modelos que usa no dia a dia. Os favoritos
            ficam salvos neste Mac.
          </p>
        )}
      </section>

      <div className="models-providers">
        {(catalog.data ?? []).map((entry) => {
          const models = entry.models.filter(
            (model) =>
              term === "" ||
              model.id.toLowerCase().includes(term) ||
              model.label.toLowerCase().includes(term) ||
              model.description?.toLowerCase().includes(term),
          );
          if (!models.length && term) return null;
          const health = doctor.data?.clients.find(
            (client) => client.client === entry.runtimeKind,
          );
          const open = term !== "" || openProviders.has(entry.runtimeKind);
          return (
            <section
              className="models-provider"
              data-provider={entry.runtimeKind}
              key={entry.runtimeKind}
            >
              <button
                aria-expanded={open}
                className="models-provider__summary"
                onClick={() =>
                  setOpenProviders((current) => {
                    const next = new Set(current);
                    if (next.has(entry.runtimeKind))
                      next.delete(entry.runtimeKind);
                    else next.add(entry.runtimeKind);
                    return next;
                  })
                }
                type="button"
              >
                <span className="models-provider__glyph" aria-hidden="true">
                  {providerGlyph(entry.runtimeKind)}
                </span>
                <span className="models-provider__identity">
                  <strong>{entry.providerLabel}</strong>
                  <small>
                    {routeLabel(entry.routeKind)} · {entry.models.length}{" "}
                    modelos
                  </small>
                </span>
                <span className="models-provider__capacity">
                  {capabilityLabel(entry)}
                </span>
                <span
                  className="models-provider__health"
                  data-status={health?.integrationStatus ?? "unknown"}
                >
                  {health?.integrationStatus === "ready" ? (
                    <HeartPulse aria-hidden="true" size={13} />
                  ) : (
                    <CircleAlert aria-hidden="true" size={13} />
                  )}
                  {healthLabel(health?.integrationStatus)}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="models-provider__chevron"
                  size={16}
                />
              </button>

              {open && (
                <ul className="models-list">
                  {models.length === 0 && (
                    <li className="models-list__empty">{entry.source}</li>
                  )}
                  {models.map((model) => {
                    const isFavorite = favoriteKeys.has(
                      favoriteKey(entry.runtimeKind, model.id),
                    );
                    return (
                      <li key={model.id}>
                        <button
                          aria-label={`${isFavorite ? "Remover" : "Adicionar"} ${model.label} ${isFavorite ? "dos" : "aos"} favoritos`}
                          aria-pressed={isFavorite}
                          className="models-list__favorite"
                          disabled={favoriteMutation.isPending}
                          onClick={() =>
                            favoriteMutation.mutate({
                              runtimeKind: entry.runtimeKind,
                              modelId: model.id,
                              favorite: !isFavorite,
                            })
                          }
                          type="button"
                        >
                          <Star
                            aria-hidden="true"
                            fill={isFavorite ? "currentColor" : "none"}
                            size={15}
                          />
                        </button>
                        <span className="models-list__copy">
                          <strong>{model.label}</strong>
                          <small>{model.description ?? model.id}</small>
                        </span>
                        <span className="models-list__effort">
                          {model.efforts?.length
                            ? `${model.efforts.length} níveis de effort`
                            : "effort fixo"}
                        </span>
                        <button
                          className="models-list__use"
                          disabled={
                            !task ||
                            ensureLane.isPending ||
                            entry.routeKind === "unavailable" ||
                            !isRunnableRuntime(entry.runtimeKind)
                          }
                          onClick={() => handleModelUse(entry, model.id)}
                          title={
                            !task
                              ? "Crie ou selecione um projeto antes de abrir uma lane"
                              : entry.source
                          }
                          type="button"
                        >
                          <Zap aria-hidden="true" size={13} />
                          {entry.routeKind === "unavailable"
                            ? "Catálogo"
                            : "Usar"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {catalog.isLoading && (
        <p className="models-state">Consultando os CLIs instalados…</p>
      )}
      {catalog.data?.length === 0 && (
        <p className="models-state">Nenhum CLI retornou catálogo de modelos.</p>
      )}
    </section>
  );
}

function providerGlyph(runtime: string): string {
  return (
    (
      {
        claude: "CL",
        codex: "GP",
        cursor: "CU",
        agy: "AG",
        grok: "GK",
        mimo: "MI",
        minimax: "MX",
      } as Record<string, string>
    )[runtime] ?? "AI"
  );
}

function routeLabel(route: CatalogEntry["routeKind"]): string {
  if (route === "bridged" || route === "compatible") return "Sessão legada";
  if (route === "native") return "Runtime Okami";
  if (route === "direct") return "Direto";
  return "Catálogo apenas";
}

function healthLabel(status?: string): string {
  if (status === "ready") return "Pronto";
  if (status === "needs_adapter") return "Adapter pendente";
  if (status === "update_required") return "Atualização necessária";
  if (status === "unavailable") return "Não encontrado";
  return "Saúde desconhecida";
}

function capabilityLabel(entry: CatalogEntry): string {
  const efforts = new Set(entry.models.flatMap((model) => model.efforts ?? []));
  return efforts.size ? `${efforts.size} efforts` : "Execução sem effort";
}
