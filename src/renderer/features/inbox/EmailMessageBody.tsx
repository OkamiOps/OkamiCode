import { Button } from "@heroui/react";
import { FileCode2, ImageOff } from "lucide-react";
import { useMemo, useState, type SyntheticEvent } from "react";

interface EmailMessageBodyProps {
  body: string;
  format: "html" | "text";
}

const removedElements =
  "script, iframe, object, embed, form, input, button, textarea, select, base, link, meta[http-equiv]";
const remoteUrl = /^(?:https?:)?\/\//iu;
const remoteCssUrl = /url\(\s*(['"]?)(?:https?:)?\/\/.*?\1\s*\)/giu;

export function EmailMessageBody({ body, format }: EmailMessageBodyProps) {
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const hasRemoteImages = useMemo(() => containsRemoteImages(body), [body]);
  const sourceDocument = useMemo(
    () => buildEmailDocument(body, allowRemoteImages),
    [allowRemoteImages, body],
  );

  if (format === "text") {
    return (
      <div className="inbox-email-document inbox-email-document--text">
        {readableTextBody(body)}
      </div>
    );
  }

  return (
    <div className="inbox-email-document inbox-email-document--html">
      <div className="inbox-email-document__toolbar">
        <span>
          <FileCode2 aria-hidden="true" size={13} /> Mensagem formatada
        </span>
        {hasRemoteImages && !allowRemoteImages && (
          <Button
            aria-label="Carregar imagens externas"
            className="inbox-email-document__images"
            onPress={() => setAllowRemoteImages(true)}
            size="sm"
            variant="ghost"
          >
            <ImageOff aria-hidden="true" size={13} />
            Carregar imagens
          </Button>
        )}
      </div>
      <iframe
        className="inbox-email-document__frame"
        onLoad={resizeEmailFrame}
        sandbox="allow-same-origin"
        srcDoc={sourceDocument}
        title="Conteúdo HTML do email"
      />
    </div>
  );
}

export function buildEmailDocument(body: string, allowRemoteImages: boolean) {
  const parser = new DOMParser();
  const email = parser.parseFromString(body, "text/html");

  email
    .querySelectorAll(removedElements)
    .forEach((element) => element.remove());
  email.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction")
        element.removeAttribute(attribute.name);
    }
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute("href")?.trim() ?? "";
      if (href && !/^(?:https?:|mailto:|tel:|#)/iu.test(href))
        element.removeAttribute("href");
      element.setAttribute("rel", "noreferrer noopener");
    }
  });

  if (!allowRemoteImages) {
    email.querySelectorAll("img").forEach((image) => {
      const source = image.getAttribute("src")?.trim() ?? "";
      if (remoteUrl.test(source)) {
        image.removeAttribute("src");
        image.removeAttribute("srcset");
        image.setAttribute("data-okami-blocked", "true");
        image.setAttribute(
          "alt",
          image.getAttribute("alt") || "Imagem externa bloqueada",
        );
      }
    });
    email.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
      const style = element.getAttribute("style") ?? "";
      element.setAttribute("style", style.replace(remoteCssUrl, "none"));
    });
    email.querySelectorAll("style").forEach((style) => {
      style.textContent = (style.textContent ?? "").replace(
        remoteCssUrl,
        "none",
      );
    });
  }

  const contentSecurityPolicy = email.createElement("meta");
  contentSecurityPolicy.httpEquiv = "Content-Security-Policy";
  contentSecurityPolicy.content = allowRemoteImages
    ? "default-src 'none'; img-src data: cid: http: https:; style-src 'unsafe-inline'; font-src data:;"
    : "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:;";
  email.head.prepend(contentSecurityPolicy);

  const baseStyles = email.createElement("style");
  baseStyles.textContent = `
    :root { color-scheme: light; }
    html, body { min-height: 100%; margin: 0; background: #fffdfa; color: #25211d; }
    body { padding: 28px clamp(22px, 4vw, 48px); font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    img[data-okami-blocked] { display: inline-flex; min-width: 140px; min-height: 48px; border: 1px dashed #c9c1b7; border-radius: 8px; background: #f4f0eb; color: #776f67; }
    table { max-width: 100%; }
    a { color: #b84f13; text-decoration-thickness: 1px; text-underline-offset: 3px; }
    blockquote { margin: 1.25em 0; padding-left: 1em; border-left: 3px solid #ddd4ca; color: #625b54; }
    pre { max-width: 100%; overflow: auto; white-space: pre-wrap; }
  `;
  email.head.append(baseStyles);

  return `<!doctype html>${email.documentElement.outerHTML}`;
}

function containsRemoteImages(body: string) {
  const email = new DOMParser().parseFromString(body, "text/html");
  return [...email.images].some((image) =>
    remoteUrl.test(image.getAttribute("src")?.trim() ?? ""),
  );
}

function resizeEmailFrame(event: SyntheticEvent<HTMLIFrameElement>) {
  const frame = event.currentTarget;
  const document = frame.contentDocument;
  if (!document) return;
  const resize = () => {
    const height = Math.max(
      240,
      Math.min(16_000, document.documentElement.scrollHeight),
    );
    frame.style.height = `${height}px`;
  };
  resize();
  document.querySelectorAll("img").forEach((image) => {
    image.addEventListener("load", resize, { once: true });
    image.addEventListener("error", resize, { once: true });
  });
}

function readableTextBody(body: string) {
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  let hiddenLink = false;
  return lines
    .flatMap((line) => {
      const candidate = line.trim().replace(/^\[|\]$/gu, "");
      if (/^https?:\/\/\S{120,}$/iu.test(candidate)) {
        if (hiddenLink) return [];
        hiddenLink = true;
        return ["[Link técnico ocultado para facilitar a leitura]"];
      }
      return [line];
    })
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
