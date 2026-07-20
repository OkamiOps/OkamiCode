import { useCallback, useRef, useState, type PointerEvent } from "react";

// Persisted pane width with a drag handle, the way Claude/Codex/Cursor let
// you reshape their panels.
export function useResizablePane(options: {
  storageKey: string;
  initial: number;
  min: number;
  max: number;
}) {
  const { storageKey, initial, min, max } = options;
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return Number.isFinite(stored) && stored >= min && stored <= max
        ? stored
        : initial;
    } catch {
      return initial;
    }
  });

  const persist = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(storageKey, String(Math.round(value)));
      } catch {
        // Width persistence is best effort.
      }
    },
    [storageKey],
  );

  return { width, setWidth, persist, min, max };
}

export function ResizeHandle({
  ariaLabel,
  edge,
  pane,
}: {
  ariaLabel: string;
  edge: "left" | "right";
  pane: ReturnType<typeof useResizablePane>;
}) {
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<number | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    // No setPointerCapture: it throws for synthetic pointers and would abort
    // the drag before the window listeners are attached. Window-level
    // listeners already track the pointer outside the handle.
    setDragging(true);
    const startX = event.clientX;
    const startWidth = pane.width;
    // The ceiling follows the real container: a width saved on a wider
    // window would otherwise sit past the cap and make dragging inert.
    // Dragging must not paint a text selection across the conversation.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const container = handle.parentElement;
    const ceiling = container
      ? Math.min(pane.max, Math.max(pane.min, container.clientWidth - 320))
      : pane.max;

    // The drag tracks its own latest value: the closure would otherwise
    // persist the width from the render where the drag started.
    let latest = startWidth;

    const move = (
      moveEvent: globalThis.PointerEvent | globalThis.MouseEvent,
    ) => {
      const delta =
        edge === "right"
          ? moveEvent.clientX - startX
          : startX - moveEvent.clientX;
      latest = Math.min(ceiling, Math.max(pane.min, startWidth + delta));
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => pane.setWidth(latest));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragging(false);
      pane.persist(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className="resize-handle"
      data-dragging={dragging || undefined}
      onDoubleClick={() => {
        pane.setWidth(pane.min);
        pane.persist(pane.min);
      }}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={-1}
    />
  );
}
