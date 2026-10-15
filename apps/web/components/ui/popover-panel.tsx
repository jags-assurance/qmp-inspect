"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useEscapeLayer } from "@/lib/hooks/use-escape-layer";

const MENU_ITEM = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

/**
 * A dropdown / popover panel rendered in a portal under <body>, positioned from its trigger. Use it
 * for anything opened from the sticky header (a z-20 stacking context would otherwise cap it under
 * floating notices). Dismisses on outside pointer-down and Escape (topmost layer only). z-30 on the
 * z-scale; being portalled later in the DOM than the notice stack it paints above it.
 *
 * With `role="menu"` the panel is a real menu: focus moves to the first `[role=menuitem]` on open, Arrow Up/Down
 * move (wrapping), Home/End jump, Tab closes (focus back on the trigger), Esc closes and refocuses the trigger.
 * Items must be `role="menuitem"`; wrappers between them should be `role="none"`.
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
  onKeyDown,
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

  const isMenu = rest.role === "menu";
  // Esc returns focus to the trigger (menus and dialogs alike) so keyboard users keep their place.
  useEscapeLayer(open, () => {
    onClose();
    anchorRef.current?.focus?.();
  });

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

  // Menu: put focus on the first item once the panel is placed and visible.
  const placed = style !== null;
  useEffect(() => {
    if (!open || !isMenu || !placed) return;
    panelRef.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [open, isMenu, placed]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || !isMenu) return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM) ?? []);
    if (e.key === "Tab") {
      e.preventDefault();
      onClose();
      anchorRef.current?.focus?.();
      return;
    }
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = i <= 0 ? items.length - 1 : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  }

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
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body
  );
}
