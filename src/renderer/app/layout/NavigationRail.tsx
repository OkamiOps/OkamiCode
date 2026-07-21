import { Avatar, Button, Tooltip } from "@heroui/react";
import {
  Brain,
  CalendarDays,
  Columns3,
  Gauge,
  Home,
  Inbox,
  PanelsTopLeft,
  PlugZap,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";

interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path?: string;
}

const navigationItems: NavigationItem[] = [
  { icon: Home, label: "Início", path: "/quick-chat" },
  { icon: PanelsTopLeft, label: "Workbench", path: "/workbench" },
  { icon: Inbox, label: "Inbox", path: "/inbox" },
  { icon: CalendarDays, label: "Agenda" },
  { icon: Columns3, label: "Kanban", path: "/kanban" },
  { icon: Gauge, label: "Uso e limites", path: "/usage" },
  { icon: Brain, label: "Memória", path: "/memory" },
  { icon: Workflow, label: "Automações" },
  { icon: PlugZap, label: "Conexões", path: "/connections" },
];

export function NavigationRail() {
  return (
    <nav className="navigation-rail" aria-label="Navegação principal">
      <div className="navigation-rail__brand" aria-label="Okami">
        O
      </div>
      <div className="navigation-rail__items">
        {navigationItems.map(({ icon: Icon, label, path }) => (
          <Tooltip.Root key={label} closeDelay={0} delay={300}>
            {path ? (
              <NavLink
                aria-label={label}
                className={({ isActive }) =>
                  `rail-action${isActive ? " rail-action--active" : ""}`
                }
                to={path}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              </NavLink>
            ) : (
              <Button
                aria-label={label}
                className="rail-action rail-action--placeholder"
                isDisabled
                isIconOnly
                variant="ghost"
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              </Button>
            )}
            <Tooltip.Content className="ok-tooltip" placement="right">
              {path ? label : `${label} — em breve`}
            </Tooltip.Content>
          </Tooltip.Root>
        ))}
      </div>
      <div className="navigation-rail__footer">
        <Tooltip.Root closeDelay={0} delay={300}>
          <Button
            aria-label="Configurações"
            className="rail-action rail-action--placeholder"
            isDisabled
            isIconOnly
            variant="ghost"
          >
            <Settings aria-hidden="true" size={19} strokeWidth={1.8} />
          </Button>
          <Tooltip.Content className="ok-tooltip" placement="right">
            Configurações — em breve
          </Tooltip.Content>
        </Tooltip.Root>
        <Avatar aria-label="Conta de Marcos" className="rail-avatar" size="sm">
          <Avatar.Fallback className="rail-avatar__fallback">
            MK
          </Avatar.Fallback>
        </Avatar>
      </div>
    </nav>
  );
}
