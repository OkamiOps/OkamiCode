import "../styles/tokens.css";
import "../styles/global.css";
import "../styles/workbench.css";
import "../styles/usage.css";
import { AppProviders } from "./providers";
import { AppRouter } from "./router";

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
