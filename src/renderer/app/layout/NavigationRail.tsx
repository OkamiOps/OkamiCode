import { Tooltip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  Brain,
  CalendarDays,
  Columns3,
  Cog,
  Gauge,
  Home,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  PlugZap,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { workbenchClient } from "../../lib/ipc/client";
import { ChatSidebar } from "./ChatSidebar";

interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

const navigationItems: NavigationItem[] = [
  { icon: Home, label: "Início", path: "/quick-chat" },
  { icon: PanelsTopLeft, label: "Workbench", path: "/workbench" },
  { icon: Inbox, label: "Inbox", path: "/inbox" },
  { icon: CalendarDays, label: "Agenda", path: "/calendar" },
  { icon: Columns3, label: "Kanban", path: "/kanban" },
  { icon: Gauge, label: "Uso e limites", path: "/usage" },
  { icon: Brain, label: "Memória", path: "/memory" },
  { icon: PlugZap, label: "Conexões", path: "/connections" },
  { icon: SlidersHorizontal, label: "Gestão", path: "/management" },
  { icon: Sparkles, label: "Modelos", path: "/models" },
  { icon: Bot, label: "Agentes", path: "/agents" },
  { icon: Cog, label: "Configurações", path: "/settings" },
];

interface NavigationRailProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  showWorkbench: boolean;
}

export function NavigationRail({
  collapsed,
  onCollapsedChange,
  showWorkbench,
}: NavigationRailProps) {
  const toggleLabel = collapsed ? "Expandir navegação" : "Recolher navegação";
  const usage = useQuery({
    queryKey: ["usage", "overview"],
    queryFn: () => workbenchClient.usageOverview(),
    staleTime: 60_000,
  });
  const plan =
    usage.data && "subscriptions" in usage.data
      ? (usage.data.subscriptions.find(
          (snapshot) => snapshot.provider === "claude_max",
        )?.plan ?? null)
      : null;

  return (
    <nav
      aria-label="Navegação principal"
      className={`navigation-rail${collapsed ? " navigation-rail--collapsed" : " navigation-rail--expanded"}`}
    >
      <header className="navigation-rail__header">
        <div className="navigation-rail__brand" aria-label="Okami">
          <span aria-hidden="true" className="navigation-rail__brand-mark">
            O
          </span>
          {!collapsed && <strong>Okami</strong>}
        </div>
        <Tooltip.Root closeDelay={0} delay={300}>
          <Tooltip.Trigger<"button">
            render={(triggerProps) => (
              <button
                {...triggerProps}
                aria-label={toggleLabel}
                className="rail-action navigation-rail__toggle"
                onClick={() => onCollapsedChange(!collapsed)}
                type="button"
              >
                {collapsed ? (
                  <PanelLeftOpen
                    aria-hidden="true"
                    size={18}
                    strokeWidth={1.8}
                  />
                ) : (
                  <PanelLeftClose
                    aria-hidden="true"
                    size={18}
                    strokeWidth={1.8}
                  />
                )}
              </button>
            )}
          />
          <Tooltip.Content className="ok-tooltip" placement="right">
            {toggleLabel}
          </Tooltip.Content>
        </Tooltip.Root>
      </header>
      <div className="navigation-rail__items">
        <div className="navigation-rail__destinations">
          {navigationItems.map(({ icon: Icon, label, path }) => {
            const destination = (triggerProps = {}) => (
              <NavLink
                {...triggerProps}
                aria-label={label}
                className={({ isActive }) =>
                  `rail-action${isActive ? " rail-action--active" : ""}`
                }
                key={label}
                role="link"
                to={path}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                {!collapsed && (
                  <span className="rail-action__label">{label}</span>
                )}
              </NavLink>
            );

            return collapsed ? (
              <Tooltip.Root key={label} closeDelay={0} delay={300}>
                <Tooltip.Trigger<"a">
                  render={(triggerProps) => destination(triggerProps)}
                />
                <Tooltip.Content className="ok-tooltip" placement="right">
                  {label}
                </Tooltip.Content>
              </Tooltip.Root>
            ) : (
              destination()
            );
          })}
        </div>
        {!collapsed && showWorkbench && (
          <section
            className="navigation-rail__workbench"
            aria-label="Workbench"
          >
            <ChatSidebar />
          </section>
        )}
      </div>
      <footer className="navigation-rail__footer">
        {collapsed ? (
          <Tooltip.Root closeDelay={0} delay={300}>
            <Tooltip.Trigger<"span">
              render={(triggerProps) => (
                <span
                  {...triggerProps}
                  aria-label="Conta de Marcos"
                  className="navigation-account__avatar"
                >
                  M
                </span>
              )}
            />
            <Tooltip.Content className="ok-tooltip" placement="right">
              Marcos{plan ? ` · ${plan}` : ""}
            </Tooltip.Content>
          </Tooltip.Root>
        ) : (
          <div className="navigation-account">
            <span aria-hidden="true" className="navigation-account__avatar">
              M
            </span>
            <span className="navigation-account__meta">
              <strong>Marcos</strong>
              <small>{plan ?? "Conta local"}</small>
            </span>
          </div>
        )}
      </footer>
    </nav>
  );
}
