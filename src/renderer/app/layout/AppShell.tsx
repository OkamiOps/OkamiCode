import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Outlet } from "react-router-dom";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
} from "../../features/workbench/store";
import { ChatSidebar } from "./ChatSidebar";

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

  return (
    <QueryClientProvider client={queryClient}>
      <WorkbenchStoreContext.Provider value={store}>
        <div className="chat-shell">
          <ChatSidebar />
          <main className="chat-main">
            <Outlet context={emptyOutletContext} />
          </main>
        </div>
      </WorkbenchStoreContext.Provider>
    </QueryClientProvider>
  );
}
