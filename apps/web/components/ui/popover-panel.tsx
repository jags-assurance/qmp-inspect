"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useEscapeLayer } from "@/lib/hooks/use-escape-layer";

/**
 * A dropdown / popover panel rendered in a portal under <body>, positioned from its trigger. Use it
 * for anything opened from the sticky header (a z-20 stacking context would otherwise cap it under
 * floating notices). Dismisses on outside pointer-down and Escape (topmost layer only). z-30 on the
 * z-scale; being portalled later in the DOM than the notice stack it paints above it.
 *
 * `anchorRef` is the trigger element (clicks on it do not count as "outside": the trigger toggles).
 * On phones (< 640px) the panel spans the screen width (8px margins) below the trigger.
 */
export function PopoverPanel({
  open,
  onClose,
  anchorRef,
  align = "end",
  className,
  children,
  ...rest
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style">) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEscapeLayer(open, onClose);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const top = r.bottom + 8;
      if (vw < 640) {
        setStyle({ position: "fixed", top, left: 8, right: 8 });
        return;
      }
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      const alignRight = (align === "end") !== rtl;
      setStyle(alignRight ? { position: "fixed", top, right: Math.max(8, vw - r.right) } : { position: "fixed", top, left: Math.max(8, r.left) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      style={style ?? { position: "fixed", visibility: "hidden" }}
      className={cn("z-30 max-h-[calc(100dvh-5rem)] rounded-lg border border-border bg-surface shadow-lg", className)}
      {...rest}
    >
      {children}
    </div>,
    document.body
  );
}
