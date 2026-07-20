import { Navigate, Route, Routes } from "react-router-dom";
import { QuickChatPage } from "../features/quick-chat/QuickChatPage";
import { ConnectionsPage } from "../features/ecosystem/ConnectionsPage";
import { MemoryPage } from "../features/ecosystem/MemoryPage";
import { SettingsPage } from "../features/ecosystem/SettingsPage";
import { UsagePage } from "../features/usage/UsagePage";
import { WorkbenchPage } from "../features/workbench/WorkbenchPage";
import { AppShell } from "./layout/AppShell";

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/quick-chat" element={<QuickChatPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/workbench" replace />} />
    </Routes>
  );
}
