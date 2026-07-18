import { Button, Tabs, Tooltip } from "@heroui/react";
import { ChevronRight, Link2 } from "lucide-react";

interface DetailsPanelProps {
  areaLabel: string;
  onCollapse?: () => void;
}

export function DetailsPanel({ areaLabel, onCollapse }: DetailsPanelProps) {
  return (
    <aside className="details-panel" aria-label="Detalhes contextuais">
      {onCollapse && (
        <Tooltip.Root closeDelay={0} delay={300}>
          <Button
            aria-label="Recolher painel de detalhes"
            className="icon-button details-collapse"
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
      <Tabs
        aria-label="Visualização de detalhes"
        className="details-tabs"
        defaultSelectedKey="details"
        variant="secondary"
      >
        <Tabs.List aria-label="Seções de detalhes">
          <Tabs.Tab id="details">Detalhes</Tabs.Tab>
          <Tabs.Tab id="links">Vínculos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="details">
          <div className="details-scroll">
            <section className="detail-group">
              <h3>Área ativa</h3>
              <div className="detail-row">
                <span>Área</span>
                <strong>{areaLabel}</strong>
              </div>
              <div className="detail-row">
                <span>Runtime</span>
                <strong>ocioso</strong>
              </div>
            </section>
            <section className="detail-group">
              <h3>Workspace</h3>
              <div className="detail-row">
                <span>Pasta</span>
                <strong className="detail-row__mono">não selecionada</strong>
              </div>
              <div className="detail-row">
                <span>Permissões</span>
                <strong>Padrão seguro</strong>
              </div>
            </section>
            <section className="detail-group">
              <h3>Fonte</h3>
              <p className="detail-source-note">
                <span
                  aria-hidden="true"
                  className="source-dot source-dot--stale"
                />
                aguardando seleção · stale
              </p>
            </section>
          </div>
        </Tabs.Panel>
        <Tabs.Panel id="links">
          <div className="details-empty">
            <Link2 aria-hidden="true" size={18} />
            <p>Nenhum vínculo para esta seleção.</p>
          </div>
        </Tabs.Panel>
      </Tabs>
    </aside>
  );
}
