import { Button, Card, Tooltip } from "@heroui/react";
import { ExternalLink, Globe2, ImageOff } from "lucide-react";

interface BrowserCardProps {
  screenshot?: string;
  title?: string;
  url: string;
}

function screenshotSource(value: string | undefined): string | undefined {
  return value && /^(?:data:image\/|blob:)/u.test(value) ? value : undefined;
}

export function BrowserCard({ screenshot, title, url }: BrowserCardProps) {
  const displayTitle = title?.trim() || "Navegador";
  const safeScreenshot = screenshotSource(screenshot);

  return (
    <Card className="overflow-hidden rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-1)]">
      <Card.Header className="flex items-start gap-2 border-b border-[var(--ok-border)] px-3 py-2">
        <Globe2
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[var(--ok-cyan)]"
          size={15}
        />
        <div className="min-w-0 flex-1">
          <Card.Title className="truncate text-xs font-semibold">
            {displayTitle}
          </Card.Title>
          <Card.Description className="mt-0.5 truncate text-[10px] text-[var(--ok-text-muted)]">
            {url}
          </Card.Description>
        </div>
        <span className="inline-flex" title="requer lease">
          <Tooltip.Root closeDelay={0} delay={250}>
            <Button
              aria-label="Abrir externamente"
              className="h-7 border border-[var(--ok-border)] bg-[var(--ok-surface-2)] px-2 text-[10px] text-[var(--ok-text-muted)]"
              isDisabled
              size="sm"
              variant="secondary"
            >
              <ExternalLink aria-hidden="true" size={12} />
              Abrir externamente
            </Button>
            <Tooltip.Content className="ok-tooltip" placement="left">
              requer lease
            </Tooltip.Content>
          </Tooltip.Root>
        </span>
      </Card.Header>
      <Card.Content className="bg-[var(--ok-bg)] p-2">
        {safeScreenshot ? (
          <img
            alt={`Captura de ${displayTitle}`}
            className="max-h-80 w-full rounded-[var(--ok-radius-sm)] border border-[var(--ok-border)] object-contain"
            src={safeScreenshot}
          />
        ) : (
          <div className="grid h-32 place-content-center justify-items-center gap-2 text-[11px] text-[var(--ok-text-muted)]">
            <ImageOff aria-hidden="true" size={18} />
            Captura indisponível
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
