import { Button, Tabs, Tooltip } from "@heroui/react";
import { ChevronRight, GitBranch, Link2, ShieldCheck } from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge";

interface DetailsPanelProps {
  areaLabel: string;
  onCollapse?: () => void;
}

export function DetailsPanel({ areaLabel, onCollapse }: DetailsPanelProps) {
  return (
    <aside className="details-panel" aria-label="Detalhes contextuais">
      <header className="pane-header details-panel__header">
        <div>
          <p className="pane-kicker">Contexto</p>
          <h2>Detalhes</h2>
        </div>
        {onCollapse && (
          <Tooltip.Root closeDelay={0} delay={300}>
            <Button
              aria-label="Recolher painel de detalhes"
              className="icon-button"
              isIconOnly
              variant="ghost"
              onPress={onCollapse}
            >
              <ChevronRight aria-hidden="true" size={17} />
            </Button>
            <Tooltip.Content className="ok-tooltip" placement="left">
              Recolher painel de detalhes
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </header>
      <Tabs
        aria-label="Visualização de detalhes"
        className="details-tabs"
        defaultSelectedKey="details"
        variant="secondary"
      >
        <Tabs.List aria-label="Seções de detalhes">
          <Tabs.Tab id="details">Detalhes</Tabs.Tab>
          <Tabs.Tab id="links">Links</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="details">
          <dl className="details-list">
            <div>
              <dt>Área</dt>
              <dd>{areaLabel}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>
                <StatusBadge label="ocioso" status="neutral" />
              </dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>Nenhum selecionado</dd>
            </div>
            <div>
              <dt>Permissões</dt>
              <dd className="details-inline-value">
                <ShieldCheck aria-hidden="true" size={14} /> Padrão seguro
              </dd>
            </div>
          </dl>
        </Tabs.Panel>
        <Tabs.Panel id="links">
          <div className="details-empty">
            <Link2 aria-hidden="true" size={18} />
            <p>Nenhum vínculo para esta seleção.</p>
          </div>
        </Tabs.Panel>
      </Tabs>
      <footer className="details-panel__footer">
        <GitBranch aria-hidden="true" size={14} />
        <span>Git aguardando workspace</span>
      </footer>
    </aside>
  );
}
