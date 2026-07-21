import { Button } from "@heroui/react";
import { FileCode2, ImageOff, ShieldCheck } from "lucide-react";
import { useMemo, useState, type SyntheticEvent } from "react";
import { workbenchClient } from "../../lib/ipc/client";

interface EmailMessageBodyProps {
  body: string;
  format: "html" | "text";
  sender: string;
}

const remoteImageTrustKey = "okami.inbox.remoteImages.allowedSenders.v1";

const removedElements =
  "script, iframe, object, embed, form, input, button, textarea, select, base, link, meta[http-equiv]";
const remoteUrl = /^(?:https?:)?\/\//iu;
const remoteCssUrl = /url\(\s*(['"]?)(?:https?:)?\/\/.*?\1\s*\)/giu;

export function EmailMessageBody({
  body,
  format,
  sender,
}: EmailMessageBodyProps) {
  const senderAddress = useMemo(() => addressFromSender(sender), [sender]);
  const [allowRemoteImages, setAllowRemoteImages] = useState(() =>
    isTrustedImageSender(senderAddress),
  );
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
      </div>
      {hasRemoteImages && !allowRemoteImages && (
        <div className="inbox-email-document__privacy" role="note">
          <span className="inbox-email-document__privacy-copy">
            <span className="inbox-email-document__privacy-mark">
              <ImageOff aria-hidden="true" size={14} />
            </span>
            <span>
              <strong>Imagens externas bloqueadas</strong>
              <small>
                Imagens externas bloqueadas para proteger sua privacidade.
              </small>
            </span>
          </span>
          <span className="inbox-email-document__privacy-actions">
            <Button
              aria-label="Carregar imagens agora"
              className="inbox-email-document__images"
              onPress={() => setAllowRemoteImages(true)}
              size="sm"
              variant="ghost"
            >
              Carregar agora
            </Button>
            {senderAddress && (
              <Button
                aria-label={`Sempre permitir imagens de ${senderAddress}`}
                className="inbox-email-document__images inbox-email-document__images--trust"
                onPress={() => {
                  trustImageSender(senderAddress);
                  setAllowRemoteImages(true);
                }}
                size="sm"
                variant="ghost"
              >
                <ShieldCheck aria-hidden="true" size={13} />
                Sempre para este remetente
              </Button>
            )}
          </span>
        </div>
      )}
      <iframe
        className="inbox-email-document__frame"
        onLoad={initializeEmailFrame}
        sandbox="allow-same-origin allow-popups"
        srcDoc={sourceDocument}
        title="Conteúdo HTML do email"
      />
    </div>
  );
}

function addressFromSender(sender: string) {
  const bracketed = sender.match(/<([^<>]+)>/u)?.[1];
  const candidate = (bracketed ?? sender).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : "";
}

function isTrustedImageSender(senderAddress: string) {
  return (
    senderAddress.length > 0 &&
    readTrustedImageSenders().includes(senderAddress)
  );
}

function trustImageSender(senderAddress: string) {
  const trusted = new Set(readTrustedImageSenders());
  trusted.add(senderAddress);
  try {
    globalThis.localStorage.setItem(
      remoteImageTrustKey,
      JSON.stringify([...trusted].sort()),
    );
  } catch {
    // Loading still applies to this message when local persistence is unavailable.
  }
}

function readTrustedImageSenders(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.localStorage.getItem(remoteImageTrustKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().toLowerCase())
          .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)),
      ),
    ];
  } catch {
    return [];
  }
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
      const trustedWebLink = /^https?:/iu.test(href);
      if (href && !/^(?:https?:|mailto:|tel:|#)/iu.test(href)) {
        element.removeAttribute("href");
        element.removeAttribute("target");
      } else if (trustedWebLink) {
        element.setAttribute("target", "_blank");
      } else {
        element.removeAttribute("target");
      }
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

  const hasAuthoredPresentation = Boolean(
    email.querySelector(
      "style, [style], [bgcolor], [background], table[width], td[width]",
    ),
  );
  if (!hasAuthoredPresentation)
    email.body.setAttribute("data-okami-fallback", "true");

  const contentSecurityPolicy = email.createElement("meta");
  contentSecurityPolicy.httpEquiv = "Content-Security-Policy";
  contentSecurityPolicy.content = allowRemoteImages
    ? "default-src 'none'; img-src data: cid: http: https:; style-src 'unsafe-inline'; font-src data:;"
    : "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:;";
  email.head.prepend(contentSecurityPolicy);

  const baseStyles = email.createElement("style");
  baseStyles.setAttribute("data-okami-reader", "true");
  baseStyles.textContent = `
    :where(html, body) { min-height: 100%; margin: 0; }
    body[data-okami-fallback="true"] { padding: 32px clamp(24px, 5vw, 56px); background: #fffdfa; color: #25211d; font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
    :where(img) { max-width: 100%; height: auto; }
    img[data-okami-blocked] { display: inline-block; min-width: 0; min-height: 0; max-width: 96px !important; max-height: 40px !important; border: 1px dashed #c9c1b7; border-radius: 7px; background: #f4f0eb; color: #776f67; font-size: 9px; object-fit: contain; }
    body[data-okami-fallback="true"] a { color: #b84f13; text-decoration-thickness: 1px; text-underline-offset: 3px; }
    body[data-okami-fallback="true"] blockquote { margin: 1.25em 0; padding-left: 1em; border-left: 3px solid #ddd4ca; color: #625b54; }
    :where(pre) { max-width: 100%; overflow: auto; white-space: pre-wrap; }
  `;
  email.head.prepend(baseStyles);

  return `<!doctype html>${email.documentElement.outerHTML}`;
}

function containsRemoteImages(body: string) {
  const email = new DOMParser().parseFromString(body, "text/html");
  return [...email.images].some((image) =>
    remoteUrl.test(image.getAttribute("src")?.trim() ?? ""),
  );
}

function initializeEmailFrame(event: SyntheticEvent<HTMLIFrameElement>) {
  const frame = event.currentTarget;
  const document = frame.contentDocument;
  if (!document) return;
  activateEmailDocumentLinks(document, (url) => {
    void workbenchClient.systemOpenExternal({ url });
  });
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

export function activateEmailDocumentLinks(
  document: Document,
  openExternal: (url: string) => void,
): void {
  document.addEventListener("click", (event) => {
    const target = event.target as {
      closest?: (selector: string) => Element | null;
    } | null;
    const anchor = target?.closest?.("a[href]");
    if (!anchor || anchor.tagName.toLowerCase() !== "a") return;
    const href = anchor.getAttribute("href")?.trim() ?? "";
    if (!isTrustedWebLink(href)) return;
    event.preventDefault();
    openExternal(href);
  });
}

function isTrustedWebLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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
