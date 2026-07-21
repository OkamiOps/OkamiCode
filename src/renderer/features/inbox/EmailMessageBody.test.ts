import { describe, expect, it, vi } from "vitest";
import {
  activateEmailDocumentLinks,
  buildEmailDocument,
} from "./EmailMessageBody";

function parse(source: string) {
  return new DOMParser().parseFromString(source, "text/html");
}

describe("buildEmailDocument", () => {
  it("preserves an authored email canvas instead of imposing the reader theme", () => {
    const source = buildEmailDocument(
      '<style>body{background:#080910;color:#f7f7f8}.card{padding:32px}</style><main class="card">OKAMI</main>',
      false,
    );
    const document = parse(source);

    expect(document.body.getAttribute("data-okami-fallback")).toBeNull();
    expect(document.documentElement.textContent).toContain(
      "body{background:#080910;color:#f7f7f8}",
    );
  });

  it("adds a readable fallback only to unstyled HTML", () => {
    const document = parse(
      buildEmailDocument("<h1>Aviso</h1><p>Corpo simples.</p>", false),
    );

    expect(document.body.getAttribute("data-okami-fallback")).toBe("true");
  });

  it("routes trusted web links through a new Electron window request", () => {
    const document = parse(
      buildEmailDocument(
        '<a href="https://meet.google.com/abc-defg-hij">Entrar no Meet</a><a href="javascript:alert(1)">Ruim</a>',
        false,
      ),
    );

    const links = document.querySelectorAll("a");
    expect(links[0]?.getAttribute("href")).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(links[1]?.hasAttribute("href")).toBe(false);
    expect(links[1]?.hasAttribute("target")).toBe(false);
  });

  it("forwards a click from the sandboxed email document to the trusted parent", () => {
    const document = parse(
      '<a href="https://meet.google.com/abc-defg-hij"><img alt="Meet"></a>',
    );
    const openExternal = vi.fn();
    activateEmailDocumentLinks(document, openExternal);

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    document.querySelector("img")?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(
      "https://meet.google.com/abc-defg-hij",
    );
  });

  it("forwards links created in the iframe realm", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDocument = frame.contentDocument;
    expect(frameDocument).not.toBeNull();
    frameDocument!.body.innerHTML =
      '<a href="https://meet.google.com/realm-test"><span>Meet</span></a>';
    const openExternal = vi.fn();
    activateEmailDocumentLinks(frameDocument!, openExternal);

    frameDocument!
      .querySelector("span")
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

    expect(openExternal).toHaveBeenCalledWith(
      "https://meet.google.com/realm-test",
    );
    frame.remove();
  });
});
