import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

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

  return { width, setWidth, persist, initial, min, max };
}

export function ResizeHandle({
  ariaLabel,
  className,
  edge,
  pane,
}: {
  ariaLabel: string;
  className?: string;
  edge: "left" | "right";
  pane: ReturnType<typeof useResizablePane>;
}) {
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<number | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupDragRef.current?.();
      cleanupDragRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [],
  );

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
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      cleanupDragRef.current = null;
    };
    const up = () => {
      cleanup();
      setDragging(false);
      pane.persist(latest);
    };
    cleanupDragRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const direction = edge === "right" ? 1 : -1;
    const delta =
      event.key === "ArrowRight"
        ? 12 * direction
        : event.key === "ArrowLeft"
          ? -12 * direction
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = Math.min(pane.max, Math.max(pane.min, pane.width + delta));
    pane.setWidth(next);
    pane.persist(next);
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={pane.max}
      aria-valuemin={pane.min}
      aria-valuenow={Math.round(pane.width)}
      className={["resize-handle", className].filter(Boolean).join(" ")}
      data-dragging={dragging || undefined}
      onDoubleClick={() => {
        pane.setWidth(pane.initial);
        pane.persist(pane.initial);
      }}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      role="slider"
      tabIndex={0}
    />
  );
}
