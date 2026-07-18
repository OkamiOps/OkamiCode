import { Card } from "@heroui/react";
import { FileDiff } from "lucide-react";
import { html as renderDiff } from "diff2html";
import { ColorSchemeType } from "diff2html/lib/types";
import "diff2html/bundles/css/diff2html.min.css";

interface DiffCardProps {
  diff: string;
}

export function DiffCard({ diff }: DiffCardProps) {
  const rendered = renderDiff(diff, {
    colorScheme: ColorSchemeType.DARK,
    drawFileList: false,
    matching: "lines",
    outputFormat: "line-by-line",
  });

  return (
    <Card className="overflow-hidden rounded-[var(--ok-radius-md)] border border-[var(--ok-border)] bg-[var(--ok-surface-1)]">
      <Card.Header className="flex items-center gap-2 border-b border-[var(--ok-border)] px-3 py-2">
        <FileDiff
          aria-hidden="true"
          className="text-[var(--ok-orange)]"
          size={15}
        />
        <Card.Title className="text-xs font-semibold">Alterações</Card.Title>
      </Card.Header>
      <Card.Content
        aria-label="Diff renderizado"
        className="max-h-96 overflow-auto text-xs [&_.d2h-code-line-ctn]:font-mono [&_.d2h-file-header]:bg-[var(--ok-surface-2)] [&_.d2h-file-wrapper]:border-[var(--ok-border)] [&_.d2h-info]:bg-[var(--ok-surface-3)]"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </Card>
  );
}
