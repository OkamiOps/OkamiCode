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
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge";

interface SidebarItem {
  count?: number;
  icon: LucideIcon;
  label: string;
  status?: "neutral" | "offline" | "online" | "warning";
  statusLabel?: string;
}

interface SidebarSection {
  id: string;
  items: SidebarItem[];
  title: string;
}

const workbenchSections: SidebarSection[] = [
  {
    id: "tasks",
    title: "Tarefas",
    items: [
      { icon: CircleDot, label: "Abertas", count: 0 },
      { icon: ShieldAlert, label: "Aguardando aprovação", count: 0 },
      { icon: CheckCircle2, label: "Concluídas", count: 0 },
    ],
  },
  {
    id: "lanes",
    title: "Lanes",
    items: [
      {
        icon: Sparkles,
        label: "Claude Code",
        status: "neutral",
        statusLabel: "ociosa",
      },
      {
        icon: Bot,
        label: "Codex",
        status: "neutral",
        statusLabel: "ociosa",
      },
    ],
  },
  {
    id: "filters",
    title: "Filtros",
    items: [
      { icon: History, label: "Recentes" },
      { icon: Filter, label: "Com aprovação" },
    ],
  },
];

const areaSections: Record<string, SidebarSection[]> = {
  "/quick-chat": [
    {
      id: "conversations",
      title: "Conversas",
      items: [
        { icon: MessageSquare, label: "Recentes", count: 0 },
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
        { icon: KeyRound, label: "Assinaturas" },
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
        { icon: FolderSearch2, label: "Fontes", count: 0 },
        { icon: Search, label: "Índice local" },
      ],
    },
  ],
  "/connections": [
    {
      id: "connections",
      title: "Conexões",
      items: [
        { icon: Plug, label: "Provedores", count: 0 },
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
  const sections = areaSections[areaPath] ?? workbenchSections;

  return (
    <aside className="sidebar" aria-label="Navegação contextual">
      <header className="pane-header sidebar__header">
        <div>
          <p className="pane-kicker">Área</p>
          <h2>{areaPath === "/workbench" ? "Workbench" : "Explorar"}</h2>
        </div>
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
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className="sidebar-section__body">
                {section.items.map(
                  ({ count, icon: Icon, label, status, statusLabel }) => (
                    <Button
                      className="sidebar-item"
                      fullWidth
                      key={label}
                      variant="ghost"
                    >
                      <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                      <span className="sidebar-item__label">{label}</span>
                      {statusLabel ? (
                        <StatusBadge label={statusLabel} status={status} />
                      ) : (
                        count !== undefined && (
                          <span className="sidebar-item__count">{count}</span>
                        )
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
