import { describe, expect, it } from "vitest";
import { buildEmailDocument } from "./EmailMessageBody";

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
});
