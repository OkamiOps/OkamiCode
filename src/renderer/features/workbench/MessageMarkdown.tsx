import { Check, Copy } from "lucide-react";
import { useRef, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
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

export function MessageMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        code: InlineCode,
        pre: CodeBlock,
        a: ({ children, ...props }) => (
          <a {...props} rel="noreferrer noopener" target="_blank">
            {children}
          </a>
        ),
      }}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, sanitizeSchema],
        rehypeHighlight,
      ]}
      // remark-breaks keeps single newlines as line breaks — models answer
      // "one per line" and chat UIs are expected to honor it.
      remarkPlugins={[remarkGfm, remarkBreaks]}
    >
      {children}
    </ReactMarkdown>
  );
}
