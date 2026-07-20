import type { DetailedHTMLProps, HTMLAttributes } from "react";

// Electron's <webview> tag for the embedded preview browser.
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        webview: DetailedHTMLProps<
          HTMLAttributes<HTMLElement> & {
            src?: string;
            partition?: string;
            allowpopups?: string;
          },
          HTMLElement
        >;
      }
    }
  }
}
