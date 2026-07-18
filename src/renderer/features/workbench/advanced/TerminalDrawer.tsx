import "@xterm/xterm/css/xterm.css";
import { Drawer } from "@heroui/react";
import { FolderCode, SquareTerminal } from "lucide-react";
import { useEffect, useRef } from "react";

interface TerminalDrawerProps {
  command?: string;
  output: string;
  workspacePath?: string;
}

function ReadOnlyTerminal({ output }: { output: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let disposed = false;
    let disposeTerminal: (() => void) | undefined;

    void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]).then(
      ([{ Terminal }, { FitAddon }]) => {
        if (disposed) return;
        const terminal = new Terminal({
          convertEol: true,
          cursorInactiveStyle: "none",
          disableStdin: true,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          scrollback: 5_000,
          theme: {
            background: "#08090c",
            foreground: "#f2f2f4",
            cursor: "#08090c",
            selectionBackground: "#2a2d35",
          },
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(viewport);
        terminal.write(output);

        const fit = () => {
          try {
            fitAddon.fit();
          } catch {
            return;
          }
        };
        const frame = window.requestAnimationFrame(fit);
        const observer =
          typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(fit);
        observer?.observe(viewport);
        disposeTerminal = () => {
          window.cancelAnimationFrame(frame);
          observer?.disconnect();
          terminal.dispose();
        };
      },
    );

    return () => {
      disposed = true;
      disposeTerminal?.();
    };
  }, [output]);

  return (
    <div
      aria-label="Saída do terminal, somente leitura"
      className="h-full min-h-72 overflow-hidden rounded-[var(--ok-radius-sm)] border border-[var(--ok-border)] bg-[var(--ok-bg)] p-2"
      ref={viewportRef}
    />
  );
}

export function TerminalDrawer({
  command,
  output,
  workspacePath,
}: TerminalDrawerProps) {
  const terminalOutput = command ? `$ ${command}\r\n${output}` : output;

  return (
    <Drawer.Root>
      <Drawer.Trigger className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-[var(--ok-radius-sm)] border border-[var(--ok-border)] bg-[var(--ok-surface-2)] px-2 text-[10px] text-[var(--ok-text)]">
        <SquareTerminal aria-hidden="true" size={12} />
        Abrir terminal avançado
      </Drawer.Trigger>
      <Drawer.Backdrop className="details-drawer-backdrop">
        <Drawer.Content
          className="mt-auto h-[min(72vh,680px)] w-full bg-[var(--ok-surface-1)]"
          placement="bottom"
        >
          <Drawer.Dialog className="grid h-full grid-rows-[auto_minmax(0,1fr)] border-t border-[var(--ok-border)] bg-[var(--ok-surface-1)] text-[var(--ok-text)]">
            <Drawer.Header className="flex min-h-12 items-center gap-3 border-b border-[var(--ok-border)] px-4">
              <SquareTerminal
                aria-hidden="true"
                className="text-[var(--ok-orange)]"
                size={16}
              />
              <div className="min-w-0 flex-1">
                <Drawer.Heading className="text-sm font-semibold">
                  Terminal avançado
                </Drawer.Heading>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-[var(--ok-text-muted)]">
                  <FolderCode aria-hidden="true" size={11} />
                  {workspacePath ?? "Workspace não informado"} · somente leitura
                </p>
              </div>
              <Drawer.CloseTrigger aria-label="Fechar terminal avançado" />
            </Drawer.Header>
            <Drawer.Body className="min-h-0 p-3">
              <ReadOnlyTerminal output={terminalOutput} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  );
}
