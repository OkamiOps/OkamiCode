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
  Plus,
  PlugZap,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import type { ButtonHTMLAttributes } from "react";
import { workbenchClient } from "../../lib/ipc/client";

interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

const navigationGroups: NavigationGroup[] = [
  {
    label: "Trabalho",
    items: [
      { icon: Home, label: "Início", path: "/home" },
      { icon: PanelsTopLeft, label: "Code", path: "/workbench" },
      { icon: Inbox, label: "Inbox", path: "/inbox" },
      { icon: CalendarDays, label: "Agenda", path: "/calendar" },
      { icon: Columns3, label: "Kanban", path: "/kanban" },
    ],
  },
  {
    label: "Inteligência",
    items: [
      { icon: Bot, label: "Agentes", path: "/agents" },
      { icon: Sparkles, label: "Modelos", path: "/models" },
      { icon: Brain, label: "Memória", path: "/memory" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { icon: Gauge, label: "Uso e limites", path: "/usage" },
      { icon: PlugZap, label: "Conexões", path: "/connections" },
      { icon: SlidersHorizontal, label: "Gestão", path: "/management" },
      { icon: Cog, label: "Configurações", path: "/settings" },
    ],
  },
];

interface NavigationRailProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function NavigationRail({
  collapsed,
  onCollapsedChange,
}: NavigationRailProps) {
  const navigate = useNavigate();
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
        {collapsed ? (
          <Tooltip.Root closeDelay={0} delay={300}>
            <Tooltip.Trigger<"button">
              render={(triggerProps) => (
                <NewChatButton
                  {...triggerProps}
                  collapsed
                  onCreate={() =>
                    navigate(
                      `/quick-chat?new=${globalThis.crypto.randomUUID()}`,
                    )
                  }
                />
              )}
            />
            <Tooltip.Content className="ok-tooltip" placement="right">
              Nova conversa
            </Tooltip.Content>
          </Tooltip.Root>
        ) : (
          <NewChatButton
            collapsed={false}
            onCreate={() =>
              navigate(`/quick-chat?new=${globalThis.crypto.randomUUID()}`)
            }
          />
        )}
        <div className="navigation-rail__destinations">
          {navigationGroups.map((group) => (
            <div
              aria-label={group.label}
              className="navigation-rail__group"
              key={group.label}
              role="group"
            >
              {!collapsed && (
                <span
                  aria-hidden="true"
                  className="navigation-rail__group-label"
                >
                  {group.label}
                </span>
              )}
              <div className="navigation-rail__group-items">
                {group.items.map(({ icon: Icon, label, path }) => {
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
                      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
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
            </div>
          ))}
        </div>
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

function NewChatButton({
  collapsed,
  onCreate,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  collapsed: boolean;
  onCreate: () => void;
}) {
  return (
    <button
      {...props}
      aria-label="Nova conversa"
      className="navigation-rail__new-chat"
      onClick={onCreate}
      type="button"
    >
      <Plus aria-hidden="true" size={17} strokeWidth={2} />
      {!collapsed && <span>Nova conversa</span>}
    </button>
  );
}
