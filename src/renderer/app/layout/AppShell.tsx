import { Button, Drawer, Tooltip } from "@heroui/react";
import {
  ChevronRight,
  ListCollapse,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ResizablePane } from "../../components/ResizablePane";
import { UsageToolbarChip } from "../../features/usage/UsageToolbarChip";
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

export interface AppShellOutletContext {
  collapseDetails: () => void;
  collapseList: () => void;
  detailsDrawerTarget: HTMLDivElement | null;
  detailsTarget: HTMLDivElement | null;
  listTarget: HTMLDivElement | null;
}

export function AppShell() {
  const { pathname } = useLocation();
  const [detailsVisible, setDetailsVisible] = useState(true);
  const [listVisible, setListVisible] = useState(true);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [detailsDrawerTarget, setDetailsDrawerTarget] =
    useState<HTMLDivElement | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [listTarget, setListTarget] = useState<HTMLDivElement | null>(null);
  const areaLabel = routeLabels[pathname] ?? "Workbench";
  const hasList = pathname === "/workbench";
  const outletContext = useMemo<AppShellOutletContext>(
    () => ({
      collapseDetails: () => setDetailsVisible(false),
      collapseList: () => setListVisible(false),
      detailsDrawerTarget,
      detailsTarget,
      listTarget,
    }),
    [detailsDrawerTarget, detailsTarget, listTarget],
  );

  return (
    <div className="app-shell" data-has-list={hasList}>
      <header className="app-toolbar">
        <div className="app-toolbar__breadcrumb" aria-label="Localização atual">
          <span>Okami</span>
          <ChevronRight aria-hidden="true" size={14} />
          <strong>{areaLabel}</strong>
        </div>
        <div className="app-toolbar__actions">
          <UsageToolbarChip />
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
                    {hasList ? (
                      <div
                        className="h-full min-h-0"
                        ref={setDetailsDrawerTarget}
                      />
                    ) : (
                      <DetailsPanel areaLabel={areaLabel} />
                    )}
                  </Drawer.Body>
                </Drawer.Dialog>
              </Drawer.Content>
            </Drawer.Backdrop>
          </Drawer.Root>
        </div>
      </header>
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
          <div className="h-full min-h-0" ref={setListTarget} />
        </ResizablePane>
      )}
      <main className="focal-region">
        <div className="pane-reopen-triggers">
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
        </div>
        <Outlet context={outletContext} />
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
          {hasList ? (
            <div className="h-full min-h-0" ref={setDetailsTarget} />
          ) : (
            <DetailsPanel
              areaLabel={areaLabel}
              onCollapse={() => setDetailsVisible(false)}
            />
          )}
        </ResizablePane>
      )}
    </div>
  );
}
