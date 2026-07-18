import { Button, Drawer, Tooltip } from "@heroui/react";
import {
  ChevronRight,
  ListCollapse,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ResizablePane } from "../../components/ResizablePane";
import { StatusBadge } from "../../components/StatusBadge";
import { DetailsPanel } from "./DetailsPanel";
import { NavigationRail } from "./NavigationRail";
import { Sidebar } from "./Sidebar";

const routeLabels: Record<string, string> = {
  "/connections": "Conexões",
  "/memory": "Memória",
  "/quick-chat": "Início",
  "/usage": "Uso e limites",
  "/workbench": "Workbench",
};

export function AppShell() {
  const { pathname } = useLocation();
  const [detailsVisible, setDetailsVisible] = useState(true);
  const [listVisible, setListVisible] = useState(true);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const areaLabel = routeLabels[pathname] ?? "Workbench";
  const hasList = pathname === "/workbench";

  return (
    <div className="app-shell" data-has-list={hasList}>
      <NavigationRail />
      {sidebarVisible && (
        <ResizablePane
          ariaLabel="Redimensionar barra lateral"
          className="sidebar-region"
          defaultSize={260}
          maxSize={280}
          minSize={240}
        >
          <Sidebar
            areaPath={pathname}
            onCollapse={() => setSidebarVisible(false)}
          />
        </ResizablePane>
      )}
      {hasList && listVisible && (
        <ResizablePane
          ariaLabel="Redimensionar lista de tarefas"
          className="list-region"
          defaultSize={320}
          maxSize={340}
          minSize={300}
        >
          <section className="queue-pane" aria-label="Lista de tarefas">
            <header className="pane-header queue-pane__header">
              <div>
                <p className="pane-kicker">Fila</p>
                <h2>Tarefas</h2>
              </div>
              <Tooltip.Root closeDelay={0} delay={300}>
                <Button
                  aria-label="Recolher lista de tarefas"
                  className="icon-button"
                  isIconOnly
                  variant="ghost"
                  onPress={() => setListVisible(false)}
                >
                  <ListCollapse aria-hidden="true" size={17} />
                </Button>
                <Tooltip.Content className="ok-tooltip" placement="right">
                  Recolher lista de tarefas
                </Tooltip.Content>
              </Tooltip.Root>
            </header>
            <div className="queue-pane__summary">
              <span>Todas</span>
              <StatusBadge label="0 ativas" status="neutral" />
            </div>
            <div className="queue-pane__empty">
              <span aria-hidden="true">00</span>
              <p>Nenhuma tarefa na fila.</p>
              <small>As tarefas criadas aparecerão aqui.</small>
            </div>
          </section>
        </ResizablePane>
      )}
      <main className="focal-region">
        <header className="app-toolbar">
          <div
            className="app-toolbar__breadcrumb"
            aria-label="Localização atual"
          >
            <span>Okami</span>
            <ChevronRight aria-hidden="true" size={14} />
            <strong>{areaLabel}</strong>
          </div>
          <div className="app-toolbar__actions">
            {!sidebarVisible && (
              <Tooltip.Root closeDelay={0} delay={300}>
                <Button
                  aria-label="Mostrar barra lateral"
                  className="icon-button sidebar-open-trigger"
                  isIconOnly
                  variant="ghost"
                  onPress={() => setSidebarVisible(true)}
                >
                  <PanelLeftOpen aria-hidden="true" size={17} />
                </Button>
                <Tooltip.Content className="ok-tooltip" placement="bottom">
                  Mostrar barra lateral
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            {hasList && !listVisible && (
              <Tooltip.Root closeDelay={0} delay={300}>
                <Button
                  aria-label="Mostrar lista de tarefas"
                  className="icon-button list-open-trigger"
                  isIconOnly
                  variant="ghost"
                  onPress={() => setListVisible(true)}
                >
                  <ListCollapse aria-hidden="true" size={17} />
                </Button>
                <Tooltip.Content className="ok-tooltip" placement="bottom">
                  Mostrar lista de tarefas
                </Tooltip.Content>
              </Tooltip.Root>
            )}
            <StatusBadge label="Uso normal" status="online" />
            <Tooltip.Root closeDelay={0} delay={300}>
              <Button
                aria-label={
                  detailsVisible
                    ? "Recolher painel de detalhes"
                    : "Mostrar painel de detalhes"
                }
                className="icon-button details-desktop-trigger"
                isIconOnly
                variant="ghost"
                onPress={() => setDetailsVisible((visible) => !visible)}
              >
                {detailsVisible ? (
                  <PanelRightClose aria-hidden="true" size={17} />
                ) : (
                  <PanelRightOpen aria-hidden="true" size={17} />
                )}
              </Button>
              <Tooltip.Content className="ok-tooltip" placement="bottom">
                {detailsVisible ? "Recolher detalhes" : "Mostrar detalhes"}
              </Tooltip.Content>
            </Tooltip.Root>
            <Drawer.Root>
              <Drawer.Trigger
                aria-label="Abrir painel de detalhes"
                className="icon-button details-drawer-trigger"
              >
                <PanelRightOpen aria-hidden="true" size={17} />
              </Drawer.Trigger>
              <Drawer.Backdrop className="details-drawer-backdrop">
                <Drawer.Content
                  className="details-drawer-content"
                  placement="right"
                >
                  <Drawer.Dialog className="details-drawer-dialog">
                    <Drawer.Header className="details-drawer-header">
                      <Drawer.Heading>Detalhes</Drawer.Heading>
                      <Drawer.CloseTrigger aria-label="Fechar painel de detalhes" />
                    </Drawer.Header>
                    <Drawer.Body className="details-drawer-body">
                      <DetailsPanel areaLabel={areaLabel} />
                    </Drawer.Body>
                  </Drawer.Dialog>
                </Drawer.Content>
              </Drawer.Backdrop>
            </Drawer.Root>
          </div>
        </header>
        <Outlet />
      </main>
      {detailsVisible && (
        <ResizablePane
          ariaLabel="Redimensionar painel de detalhes"
          className="details-region"
          defaultSize={320}
          maxSize={340}
          minSize={300}
          resizeEdge="left"
        >
          <DetailsPanel
            areaLabel={areaLabel}
            onCollapse={() => setDetailsVisible(false)}
          />
        </ResizablePane>
      )}
    </div>
  );
}
