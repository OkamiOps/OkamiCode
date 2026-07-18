import { Card } from "@heroui/react";
import { CodeXml, ShieldCheck } from "lucide-react";

export const HTML_PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;

interface HtmlPreviewCardProps {
  html: string;
}

export function HtmlPreviewCard({ html }: HtmlPreviewCardProps) {
  const srcDoc = `${CSP_META}${html}`;

  return (
    <Card className="tool-card tool-surface-card">
      <Card.Header className="tool-surface-card__header">
        <CodeXml
          aria-hidden="true"
          className="text-[var(--ok-cyan)]"
          size={15}
        />
        <Card.Title className="tool-card__name">Prévia HTML</Card.Title>
        <span className="flex items-center gap-1 text-[10px] text-[var(--ok-green)]">
          <ShieldCheck aria-hidden="true" size={12} />
          isolada
        </span>
      </Card.Header>
      <Card.Content className="tool-surface-card__body p-0">
        <iframe
          className="h-72 w-full border-0 bg-white"
          sandbox=""
          srcDoc={srcDoc}
          title="Prévia HTML"
        />
      </Card.Content>
    </Card>
  );
}
