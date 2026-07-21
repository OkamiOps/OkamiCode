import { Accordion, Button, Tooltip } from "@heroui/react";
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  Filter,
  FolderSearch2,
  Gauge,
  History,
  KeyRound,
  MessageSquare,
  Plug,
  Search,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { workbenchClient } from "../../lib/ipc/client";
import {
  laneDisplayName,
  runtimeGlyph,
} from "../../features/workbench/runtime-presentation";

interface SidebarItem {
  active?: boolean;
  count?: number;
  hot?: boolean;
  icon: LucideIcon;
  label: string;
}

interface LaneItem {
  glyph: "CL" | "GP" | "GK" | "CU" | "AG" | "MI";
  label: string;
  model: string;
  provider: string;
  route: "bridged" | "direct" | "native" | "unavailable";
}

interface SidebarSection {
  count?: number;
  hot?: boolean;
  id: string;
  items?: SidebarItem[];
  lanes?: LaneItem[];
  title: string;
}

// Workbench sections are built from live task/lane projections — never from
// invented counts or lanes the core does not report.
function buildWorkbenchSections(
  tasks: readonly { status: string }[],
  lanes: readonly LaneItem[],
): SidebarSection[] {
  const open = tasks.filter((task) => task.status === "open").length;
  const waiting = tasks.filter(
    (task) => task.status === "waiting_approval",
  ).length;
  const done = tasks.filter((task) => task.status === "completed").length;
  return [
    {
      count: open,
      hot: open > 0,
      id: "tasks",
      title: "Tarefas",
      items: [
        {
          active: true,
          hot: open > 0,
          icon: CircleDot,
          label: "Abertas",
          count: open,
        },
        { icon: ShieldAlert, label: "Aguardando aprovação", count: waiting },
        { icon: CheckCircle2, label: "Concluídas", count: done },
      ],
    },
    { count: lanes.length, id: "lanes", title: "Lanes", lanes: [...lanes] },
    {
      id: "filters",
      title: "Filtros",
      items: [
        { icon: History, label: "Recentes" },
        { icon: Filter, label: "Com aprovação" },
      ],
    },
  ];
}

const areaSections: Record<string, SidebarSection[]> = {
  "/quick-chat": [
    {
      count: 0,
      id: "conversations",
      title: "Conversas",
      items: [
        { active: true, icon: MessageSquare, label: "Recentes", count: 0 },
        { icon: Search, label: "Pesquisar" },
      ],
    },
    {
      id: "context",
      title: "Contexto",
      items: [{ icon: FolderSearch2, label: "Fontes selecionadas", count: 0 }],
    },
  ],
  "/usage": [
    {
      id: "usage",
      title: "Visões de uso",
      items: [
        { active: true, icon: KeyRound, label: "Assinaturas" },
        { icon: Gauge, label: "Runtimes" },
        { icon: Bot, label: "Modelos" },
        { icon: ShieldAlert, label: "Alertas", count: 0 },
      ],
    },
  ],
  "/memory": [
    {
      id: "memory",
      title: "Memória",
      items: [
        { active: true, icon: FolderSearch2, label: "Fontes", count: 0 },
        { icon: Search, label: "Índice local" },
      ],
    },
  ],
  "/connections": [
    {
      id: "connections",
      title: "Conexões",
      items: [
        { active: true, icon: Plug, label: "Provedores", count: 0 },
        { icon: CircleDot, label: "Estado" },
      ],
    },
  ],
};

interface SidebarProps {
  areaPath: string;
  onCollapse: () => void;
}

export function Sidebar({ areaPath, onCollapse }: SidebarProps) {
  const isWorkbench = !(areaPath in areaSections);
  const tasksQuery = useQuery({
    enabled: isWorkbench,
    queryFn: () => workbenchClient.taskList(),
    queryKey: ["sidebar", "tasks"],
  });
  const lanesQuery = useQuery({
    enabled: isWorkbench,
    queryFn: () => workbenchClient.laneList({}),
    queryKey: ["sidebar", "lanes"],
  });
  const lanes = useMemo<LaneItem[]>(
    () =>
      (lanesQuery.data ?? []).map((lane) => ({
        glyph: runtimeGlyph(lane.runtimeKind),
        label:
          lane.harness === "claude" && lane.runtimeKind !== "claude"
            ? `${lane.model} · harness Claude`
            : laneDisplayName(lane),
        model: lane.model,
        provider: lane.providerAccountLabel,
        route: lane.routeKind === "compatible" ? "direct" : lane.routeKind,
      })),
    [lanesQuery.data],
  );
  const sections =
    areaSections[areaPath] ??
    buildWorkbenchSections(tasksQuery.data ?? [], lanes);

  return (
    <aside className="sidebar" aria-label="Navegação contextual">
      <header className="pane-header sidebar__header">
        <h2>{areaPath === "/workbench" ? "Workbench" : "Explorar"}</h2>
        <Tooltip.Root closeDelay={0} delay={300}>
          <Button
            aria-label="Recolher barra lateral"
            className="icon-button"
            isIconOnly
            variant="ghost"
            onPress={onCollapse}
          >
            <ChevronLeft aria-hidden="true" size={17} />
          </Button>
          <Tooltip.Content className="ok-tooltip" placement="right">
            Recolher barra lateral
          </Tooltip.Content>
        </Tooltip.Root>
      </header>
      <Accordion
        allowsMultipleExpanded
        className="sidebar-sections"
        defaultExpandedKeys={sections.map((section) => section.id)}
        hideSeparator
      >
        {sections.map((section) => (
          <Accordion.Item id={section.id} key={section.id}>
            <Accordion.Heading>
              <Accordion.Trigger className="sidebar-section__trigger">
                <span>{section.title}</span>
                <span className="sidebar-section__meta">
                  {section.count !== undefined && (
                    <span
                      className={`sidebar-count${section.hot ? " sidebar-count--hot" : ""}`}
                    >
                      {section.count}
                    </span>
                  )}
                  <Accordion.Indicator />
                </span>
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="sidebar-section__body">
                {section.lanes?.map((lane) => (
                  <Button
                    className="sidebar-lane-row"
                    fullWidth
                    key={`${lane.label}-${lane.model}`}
                    variant="ghost"
                  >
                    <span
                      className={`lane-glyph lane-glyph--${lane.glyph.toLowerCase()}`}
                    >
                      {lane.glyph}
                    </span>
                    <span className="sidebar-lane-row__meta">
                      <strong>{lane.label}</strong>
                      <span>
                        {lane.provider} · {lane.model}
                      </span>
                    </span>
                    <span className={`route-badge route-badge--${lane.route}`}>
                      {lane.route}
                    </span>
                  </Button>
                ))}
                {section.items?.map(
                  ({ active, count, hot, icon: Icon, label }) => (
                    <Button
                      className="sidebar-item"
                      data-active={active || undefined}
                      fullWidth
                      key={label}
                      variant="ghost"
                    >
                      <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
                      <span className="sidebar-item__label">{label}</span>
                      {count !== undefined && (
                        <span
                          className={`sidebar-count${hot ? " sidebar-count--hot" : ""}`}
                        >
                          {count}
                        </span>
                      )}
                    </Button>
                  ),
                )}
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </aside>
  );
}
