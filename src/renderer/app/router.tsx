import { Navigate, Route, Routes } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { AppShell } from "./layout/AppShell";

interface ScreenProps {
  description: string;
  eyebrow: string;
  title: string;
}

function Screen({ description, eyebrow, title }: ScreenProps) {
  return (
    <section className="route-screen" aria-labelledby="route-heading">
      <header className="route-screen__header">
        <div>
          <p className="route-screen__eyebrow">{eyebrow}</p>
          <h1 id="route-heading">{title}</h1>
        </div>
        <StatusBadge label="Local" status="online" />
      </header>
      <div className="route-screen__empty">
        <span className="route-screen__empty-mark" aria-hidden="true">
          OK
        </span>
        <h2>Área pronta para receber dados</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          path="/workbench"
          element={
            <Screen
              eyebrow="Execução assistida"
              title="Okami Workbench"
              description="Selecione uma tarefa na fila para acompanhar a execução e seus eventos."
            />
          }
        />
        <Route
          path="/quick-chat"
          element={
            <Screen
              eyebrow="Conversa sem workspace"
              title="Início"
              description="Inicie uma conversa rápida e escolha explicitamente o contexto necessário."
            />
          }
        />
        <Route
          path="/usage"
          element={
            <Screen
              eyebrow="Controle de consumo"
              title="Uso e limites"
              description="As janelas de uso, alertas e limites dos runtimes aparecerão aqui."
            />
          }
        />
        <Route
          path="/memory"
          element={
            <Screen
              eyebrow="Contexto local"
              title="Memória"
              description="Configure fontes locais e pesquise o índice de memória do Workbench."
            />
          }
        />
        <Route
          path="/connections"
          element={
            <Screen
              eyebrow="Integrações locais"
              title="Conexões"
              description="A saúde das conexões de runtime e assinatura será exibida aqui."
            />
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/workbench" replace />} />
    </Routes>
  );
}
