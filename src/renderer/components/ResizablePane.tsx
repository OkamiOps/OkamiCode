import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PropsWithChildren } from "react";

interface ResizablePaneProps extends PropsWithChildren {
  ariaLabel: string;
  className?: string;
  defaultSize: number;
  maxSize: number;
  minSize: number;
  resizeEdge?: "left" | "right";
}

const KEYBOARD_STEP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ResizablePane({
  ariaLabel,
  children,
  className,
  defaultSize,
  maxSize,
  minSize,
  resizeEdge = "right",
}: ResizablePaneProps) {
  const [size, setSize] = useState(defaultSize);
  const dragOrigin = useRef<{ pointerX: number; size: number } | null>(null);

  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return;
    const pointerDelta = event.clientX - dragOrigin.current.pointerX;
    const sizeDelta = resizeEdge === "right" ? pointerDelta : -pointerDelta;
    setSize(clamp(dragOrigin.current.size + sizeDelta, minSize, maxSize));
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    dragOrigin.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextSize: number | undefined;
    if (event.key === "Home") nextSize = minSize;
    if (event.key === "End") nextSize = maxSize;
    if (event.key === "ArrowLeft") {
      nextSize =
        size + (resizeEdge === "left" ? KEYBOARD_STEP : -KEYBOARD_STEP);
    }
    if (event.key === "ArrowRight") {
      nextSize =
        size + (resizeEdge === "right" ? KEYBOARD_STEP : -KEYBOARD_STEP);
    }
    if (nextSize === undefined) return;
    event.preventDefault();
    setSize(clamp(nextSize, minSize, maxSize));
  };

  return (
    <div
      className={["resizable-pane", className].filter(Boolean).join(" ")}
      data-resize-edge={resizeEdge}
      style={{ width: size }}
    >
      <div className="resizable-pane__content">{children}</div>
      <div
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        aria-valuemax={maxSize}
        aria-valuemin={minSize}
        aria-valuenow={size}
        aria-valuetext={`${size} pixels`}
        className="resizable-pane__handle"
        role="slider"
        tabIndex={0}
        onKeyDown={resizeFromKeyboard}
        onPointerDown={(event) => {
          event.preventDefault();
          dragOrigin.current = { pointerX: event.clientX, size };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={resizeFromPointer}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
      />
    </div>
  );
}
