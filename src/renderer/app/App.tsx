import "../styles/tokens.css";
import "../styles/global.css";
import "../styles/workbench.css";
import "../styles/usage.css";
import { AppProviders } from "./providers";
import { AppRouter } from "./router";

export function App() {
  if (typeof window.okami === "undefined") {
    // A missing bridge means the preload failed to load; a black screen would
    // hide the failure, so state it plainly instead.
    return (
      <main className="boot-shell">
        <p className="eyebrow">Okami Workbench</p>
        <h1>Ponte do núcleo indisponível</h1>
        <p>
          O preload não carregou, então a interface não consegue falar com o
          núcleo. Reinicie o aplicativo; se persistir, verifique o log do
          processo principal.
        </p>
      </main>
    );
  }
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
