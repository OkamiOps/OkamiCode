import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { workbenchClient } from "../../lib/ipc/client";

export function ProviderAuthTerminal({
  provider,
  onClose,
}: {
  provider: "claude" | "cursor" | "agy" | "opencode";
  onClose: () => void;
}) {
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
        background: "#090b0f",
        foreground: "#e8e9ed",
        cursor: "#68ddeb",
        selectionBackground: "rgba(104, 221, 235, 0.24)",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    let sessionId: string | null = null;
    let disposed = false;
    const unsubscribe = window.okami.onTerminalData((chunk) => {
      const payload = chunk as {
        termId?: string;
        data?: string;
        exited?: boolean;
        exitCode?: number;
      };
      if (!sessionId || payload.termId !== sessionId) return;
      if (payload.exited) {
        terminal.writeln(
          `\r\n[conexão encerrada${payload.exitCode === 0 ? " com sucesso" : ""}]`,
        );
        return;
      }
      if (payload.data) terminal.write(payload.data);
    });

    void workbenchClient
      .providerAuthInteractiveOpen({
        provider,
        columns: Math.max(40, terminal.cols),
        rows: Math.max(12, terminal.rows),
      })
      .then((opened) => {
        if (disposed) {
          void workbenchClient.providerAuthInteractiveClose({
            sessionId: opened.sessionId,
          });
          return;
        }
        sessionId = opened.sessionId;
      })
      .catch(() => {
        terminal.writeln(
          "\r\n[não foi possível iniciar a autenticação deste provider]",
        );
      });

    const input = terminal.onData((data) => {
      if (sessionId) {
        void workbenchClient.providerAuthInteractiveWrite({ sessionId, data });
      }
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (sessionId) {
        void workbenchClient.providerAuthInteractiveResize({
          sessionId,
          columns: Math.max(40, terminal.cols),
          rows: Math.max(12, terminal.rows),
        });
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      unsubscribe();
      if (sessionId) {
        void workbenchClient.providerAuthInteractiveClose({ sessionId });
      }
      terminal.dispose();
    };
  }, [provider]);

  return (
    <div className="provider-auth-terminal">
      <header>
        <span>
          Autenticação oficial · {provider === "agy" ? "Antigravity" : provider}
        </span>
        <button
          aria-label="Fechar conexão guiada"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </header>
      <div aria-label="Terminal de autenticação" ref={hostRef} />
      <footer>
        O OkamiCode não registra a senha nem o conteúdo digitado nesta sessão.
      </footer>
    </div>
  );
}
