import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../../features/workbench/store";
import { NavigationRail } from "./NavigationRail";

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
  const [collapsed, setCollapsed] = useState(
    () =>
      globalThis.localStorage?.getItem("okami.navigation.collapsed") === "true",
  );

  useEffect(() => {
    globalThis.localStorage?.setItem(
      "okami.navigation.collapsed",
      String(collapsed),
    );
  }, [collapsed]);

  return (
    <QueryClientProvider client={queryClient}>
      <WorkbenchStoreContext.Provider value={store}>
        <ShellContent collapsed={collapsed} onCollapsedChange={setCollapsed} />
      </WorkbenchStoreContext.Provider>
    </QueryClientProvider>
  );
}

function ShellContent({
  collapsed,
  onCollapsedChange,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const location = useLocation();
  const isInbox = location.pathname === "/inbox";
  const isCalendar = location.pathname === "/calendar";
  const shellClassName =
    isInbox || isCalendar
      ? `inbox-shell navigation-shell${isCalendar ? " calendar-shell" : ""}`
      : "chat-shell navigation-shell";

  return (
    <div
      className={shellClassName}
      data-navigation-collapsed={collapsed || undefined}
    >
      <NavigationRail
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        showWorkbench={location.pathname === "/workbench"}
      />
      <main
        className={isInbox || isCalendar ? "inbox-shell__main" : "chat-main"}
      >
        <Outlet context={emptyOutletContext} />
      </main>
    </div>
  );
}
