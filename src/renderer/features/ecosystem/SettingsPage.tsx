import { useQuery } from "@tanstack/react-query";
import { Cog, ShieldCheck, Wrench } from "lucide-react";
import { workbenchClient } from "../../lib/ipc/client";
import { useWorkbenchStore } from "../workbench/store";

const PERMISSION_LABELS: Record<string, string> = {
  manual: "Manual",
  acceptEdits: "Aceitar edições",
  plan: "Planejar",
  auto: "Automático",
  bypassPermissions: "Ignorar permissões",
};

// Settings the app can state truthfully: what this conversation runs with,
// and what the CLIs have configured on this machine.
export function SettingsPage() {
  const selectedTaskId = useWorkbenchStore((state) => state.selectedTaskId);
  const effortByLane = useWorkbenchStore((state) => state.effortByLane);
  const tasks = useQuery({
    queryKey: ["workbench", "tasks"],
    queryFn: () => workbenchClient.taskList(),
  });
  const task = (tasks.data ?? []).find((entry) => entry.id === selectedTaskId);
  const lanes = useQuery({
    queryKey: ["workbench", "lanes", task?.id],
    queryFn: () => workbenchClient.laneList(task ? { taskId: task.id } : {}),
    enabled: Boolean(task),
  });
  const settings = useQuery({
    queryKey: ["eco", "settings"],
    queryFn: () => workbenchClient.ecoSettings(),
  });
  const doctor = useQuery({
    queryKey: ["system", "doctor"],
    queryFn: () => workbenchClient.systemDoctor(),
  });

  return (
    <section aria-label="Configurações" className="eco-page">
      <header className="eco-page__header">
        <h1>Configurações</h1>
        <p>O que esta conversa usa e o que os CLIs têm configurado.</p>
      </header>

      <section className="eco-card">
        <h2>
          <Cog aria-hidden="true" size={15} />
          Conversa atual
        </h2>
        {!task && <p className="eco-empty">Nenhuma conversa selecionada.</p>}
        {task && (
          <dl className="eco-facts">
            <div>
              <dt>Pasta</dt>
              <dd>
                <code>{task.workspacePath ?? "—"}</code>
              </dd>
            </div>
            {(lanes.data ?? []).map((lane) => (
              <div key={lane.laneId}>
                <dt>{lane.model}</dt>
                <dd>
                  {lane.providerAccountLabel} · rota {lane.routeKind} ·{" "}
                  {PERMISSION_LABELS[lane.permissionMode ?? "manual"] ??
                    lane.permissionMode}
                  {effortByLane[lane.laneId]
                    ? ` · effort ${effortByLane[lane.laneId]}`
                    : ""}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="eco-card">
        <h2>
          <ShieldCheck aria-hidden="true" size={15} />
          Runtimes
        </h2>
        <ul className="eco-list">
          {(doctor.data?.runtimes ?? []).map((runtime) => (
            <li key={runtime.runtime}>
              <span
                aria-hidden="true"
                className={`route-dot route-dot--${runtime.status === "ready" ? "direct" : "unavailable"}`}
              />
              <span className="eco-list__main">
                <strong>{runtime.runtime}</strong>
                <small>
                  {runtime.status}
                  {runtime.version ? ` · ${runtime.version}` : ""}
                  {runtime.detail ? ` · ${runtime.detail}` : ""}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="eco-card">
        <h2>
          <Wrench aria-hidden="true" size={15} />
          Arquivos de configuração dos CLIs
        </h2>
        <ul className="eco-list">
          {(settings.data ?? []).map((file) => (
            <li key={file.path}>
              <span className="eco-list__main">
                <strong>
                  <code>{file.path}</code>
                </strong>
                <small>
                  {file.exists
                    ? `${file.keys.length} chaves${file.effortLevel ? ` · effort ${file.effortLevel}` : ""}${file.theme ? ` · tema ${file.theme}` : ""}`
                    : "arquivo ausente"}
                </small>
              </span>
              {file.enabledPlugins && (
                <span className="eco-tag eco-tag--muted">
                  {file.enabledPlugins.length} plugins
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="eco-empty">
          Esta tela lê os arquivos; alterá-los continua sendo pelos próprios
          CLIs para não haver duas fontes de verdade.
        </p>
      </section>
    </section>
  );
}
