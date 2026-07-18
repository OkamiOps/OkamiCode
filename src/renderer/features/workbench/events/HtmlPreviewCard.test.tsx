import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { HtmlPreviewCard } from "./HtmlPreviewCard";

afterEach(cleanup);

const cspMeta =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'\">";

it("sandboxes inline html without scripts or same-origin authority", () => {
  render(
    <HtmlPreviewCard
      html={'<script>top.location="https://evil.example"</script>'}
    />,
  );

  const frame = screen.getByTitle("Prévia HTML");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  expect(frame.getAttribute("srcdoc")?.startsWith(cspMeta)).toBe(true);
});
