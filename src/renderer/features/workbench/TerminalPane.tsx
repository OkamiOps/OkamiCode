import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { workbenchClient } from "../../lib/ipc/client";

// Real shell in the conversation folder: node-pty in main, xterm here.
export function TerminalPane({ taskId }: { taskId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: {
        background: "#0a0b0e",
        foreground: "#e8e9ed",
        cursor: "#ff7a1a",
        selectionBackground: "rgba(255, 122, 26, 0.28)",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    let termId: string | null = null;
    let disposed = false;
    const unsubscribe = window.okami.onTerminalData((chunk) => {
      const payload = chunk as {
        termId?: string;
        data?: string;
        exited?: boolean;
      };
      if (!termId || payload.termId !== termId) return;
      if (payload.exited) {
        terminal.writeln("\r\n[sessão encerrada]");
        return;
      }
      if (payload.data) terminal.write(payload.data);
    });

    void workbenchClient.terminalOpen({ taskId }).then((opened) => {
      if (disposed) {
        void workbenchClient.terminalClose({ termId: opened.termId });
        return;
      }
      termId = opened.termId;
      void workbenchClient.terminalResize({
        termId: opened.termId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });

    const dataDisposable = terminal.onData((data) => {
      if (termId) void workbenchClient.terminalWrite({ termId, data });
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (termId) {
        void workbenchClient.terminalResize({
          termId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      dataDisposable.dispose();
      unsubscribe();
      if (termId) void workbenchClient.terminalClose({ termId });
      terminal.dispose();
    };
  }, [taskId]);

  return <div className="ws-terminal" ref={hostRef} />;
}
