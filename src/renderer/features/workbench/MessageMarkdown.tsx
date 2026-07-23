import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  PanelRightOpen,
} from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { toWorkspaceRelative, useFileOpener } from "./file-open";

// Inline HTML from models renders, but only through the sanitizer; the class
// allowlist is what lets highlight.js tokens keep their colors.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-[\w+-]+$/u],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", /^hljs-[\w-]+$/u],
    ],
  },
};

function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const childClass =
    child && typeof child === "object" && "props" in child
      ? String(
          (child as { props?: { className?: string } }).props?.className ?? "",
        )
      : "";
  const language = /language-([\w+-]+)/u.exec(childClass)?.[1] ?? "texto";

  function copy() {
    const text = preRef.current?.innerText ?? "";
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }

  return (
    <div className="md-code">
      <div className="md-code__bar">
        <span className="md-code__lang">{language}</span>
        <button className="md-code__copy" onClick={copy} type="button">
          {copied ? (
            <>
              <Check aria-hidden="true" size={11} />
              Copiado
            </>
          ) : (
            <>
              <Copy aria-hidden="true" size={11} />
              Copiar
            </>
          )}
        </button>
      </div>
      <pre ref={preRef} {...props}>
        {children}
      </pre>
    </div>
  );
}

// File paths written inline open the workspace viewer, like Claude/Codex.
function InlineCode({ children, ...props }: ComponentProps<"code">) {
  const opener = useFileOpener();
  const isBlock = (props.className ?? "").includes("language-");
  const text = !isBlock && typeof children === "string" ? children : null;
  const relative =
    text && opener ? toWorkspaceRelative(text, opener.workspacePath) : null;
  if (!relative || !opener) return <code {...props}>{children}</code>;
  return (
    <button
      className="md-path"
      onClick={() => opener.open(relative)}
      title={`Abrir ${relative}`}
      type="button"
    >
      {children}
    </button>
  );
}

function isTrustedWebLink(href: string | undefined): href is string {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function MessageLink({
  children,
  href,
  onOpenExternal,
  onOpenUrl,
  ...props
}: ComponentProps<"a"> & {
  onOpenExternal?: (url: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const canOpenInside = isTrustedWebLink(href) && Boolean(onOpenUrl);

  return (
    <span className="md-link">
      <a
        {...props}
        href={href}
        onClick={(event) => {
          if (!canOpenInside || !href) return;
          event.preventDefault();
          onOpenUrl?.(href);
        }}
        rel="noreferrer noopener"
        target={canOpenInside ? undefined : "_blank"}
      >
        {children}
      </a>
      {canOpenInside && href && (
        <span className="md-link__actions">
          <button
            aria-expanded={open}
            aria-label="Opções do link"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            <ChevronDown aria-hidden="true" size={12} />
          </button>
          {open && (
            <span className="md-link__menu" role="menu">
              <button
                onClick={() => {
                  onOpenUrl?.(href);
                  setOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <PanelRightOpen aria-hidden="true" size={12} />
                Abrir aqui
              </button>
              <button
                disabled={!onOpenExternal}
                onClick={() => {
                  onOpenExternal?.(href);
                  setOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <ExternalLink aria-hidden="true" size={12} />
                Abrir no navegador
              </button>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export function MessageMarkdown({
  children,
  onOpenUrl,
  onOpenExternal,
}: {
  children: string;
  onOpenUrl?: (url: string) => void;
  onOpenExternal?: (url: string) => void;
}) {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        components={{
          code: InlineCode,
          pre: CodeBlock,
          a: ({ children, ...props }) => (
            <MessageLink
              {...props}
              onOpenExternal={onOpenExternal}
              onOpenUrl={onOpenUrl}
            >
              {children}
            </MessageLink>
          ),
        }}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
          rehypeHighlight,
        ]}
        // Markdown soft-wraps stay prose. Lists, paragraphs and explicit HTML
        // breaks still render normally without turning provider line wrapping
        // into a wall of artificial visual breaks.
        remarkPlugins={[remarkGfm]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
