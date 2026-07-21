import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../../features/workbench/store";
import { ChatSidebar } from "./ChatSidebar";
import { NavigationRail } from "./NavigationRail";
import { ResizeHandle, useResizablePane } from "./ResizeHandle";

// Kept for route components that still type their outlet context.
export interface AppShellOutletContext {
  collapseDetails: () => void;
  collapseList: () => void;
  detailsDrawerTarget: HTMLDivElement | null;
  detailsTarget: HTMLDivElement | null;
  listTarget: HTMLDivElement | null;
}

const emptyOutletContext: AppShellOutletContext = {
  collapseDetails: () => undefined,
  collapseList: () => undefined,
  detailsDrawerTarget: null,
  detailsTarget: null,
  listTarget: null,
};

export function AppShell() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 5_000 },
          mutations: { retry: false },
        },
      }),
  );
  const [store] = useState(createWorkbenchStore);
  const sidebar = useResizablePane({
    storageKey: "okami.width.sidebar",
    initial: 236,
    min: 170,
    max: 620,
  });
  const location = useLocation();
  const isInbox = location.pathname === "/inbox";
  const isCalendar = location.pathname === "/calendar";

  return (
    <QueryClientProvider client={queryClient}>
      <WorkbenchStoreContext.Provider value={store}>
        {isInbox || isCalendar ? (
          <div className={`inbox-shell${isCalendar ? " calendar-shell" : ""}`}>
            <NavigationRail />
            <main className="inbox-shell__main">
              <Outlet context={emptyOutletContext} />
            </main>
          </div>
        ) : (
          <div
            className="chat-shell"
            style={
              { "--chat-sidebar-w": `${sidebar.width}px` } as CSSProperties
            }
          >
            <ChatSidebar />
            <ResizeHandle
              ariaLabel="Redimensionar a lista de conversas"
              edge="right"
              pane={sidebar}
            />
            <main className="chat-main">
              <Outlet context={emptyOutletContext} />
            </main>
          </div>
        )}
      </WorkbenchStoreContext.Provider>
    </QueryClientProvider>
  );
}
