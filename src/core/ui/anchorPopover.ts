import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { placePopover, type Placement } from "./logic.ts";

/**
 * Anchors a popover panel to a trigger element. Measures both on open and on
 * every scroll/resize, and returns an absolute-position style in *document*
 * coordinates (viewport result + scroll offset). Returns a hidden style
 * while closed or before the first measure.
 */
export function usePopover(open: boolean): {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  placement: "top" | "bottom";
} {
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Placement | null>(null);

  const measure = useCallback(() => {
    const a = anchorRef.current?.getBoundingClientRect();
    const p = panelRef.current?.getBoundingClientRect();
    if (!a) return;
    const placed = placePopover(
      { top: a.top, left: a.left, bottom: a.bottom, right: a.right, width: a.width, height: a.height },
      { width: p?.width || a.width || 240, height: p?.height || 240 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ ...placed, top: placed.top + window.scrollY, left: placed.left + window.scrollX });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, { capture: true, passive: true });
    window.addEventListener("resize", onMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", onMove, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  const style: CSSProperties = pos
    ? {
        position: "absolute",
        top: pos.top,
        left: pos.left,
        minWidth: anchorRef.current?.offsetWidth,
        // Only set when the viewport is shorter than the panel — overrides the
        // CSS `max-height` so a tall list stays fully on screen and scrolls.
        ...(pos.maxHeight != null ? { maxHeight: pos.maxHeight } : {}),
      }
    : { position: "absolute", visibility: "hidden", top: 0, left: 0 };

  return { anchorRef, panelRef, style, placement: pos?.placement ?? "bottom" };
}

let layer: HTMLDivElement | null = null;

/** Portals its children into a single shared `#nb-popover-layer` div. The
 *  layer's z-index (`--nb-popover-z`, set in core-ui.css) sits *below* the
 *  modal layer on purpose — a plugin-invoked control must not paint over
 *  Core modals. */
export function PopoverLayer({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  if (!layer || !layer.isConnected) {
    layer = document.createElement("div");
    layer.id = "nb-popover-layer";
    document.body.appendChild(layer);
  }
  return createPortal(children, layer);
}
