import "../styles/tokens.css";
import "../styles/global.css";
import { AppProviders } from "./providers";
import { AppRouter } from "./router";

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
